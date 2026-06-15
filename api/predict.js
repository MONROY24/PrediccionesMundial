const { kv } = require('@vercel/kv');
const { fetchQuantitativeFactors } = require('./lib/geminiIntelligence');
const geminiKeyManager = require('./lib/GeminiKeyManager');
const MathEngine = require('./lib/mathEngine');

// Función segura de hashing simple para la caché
function generateCacheKey(teamA, teamB) {
    const eloA = Math.round(teamA.eloRating || 0);
    const eloB = Math.round(teamB.eloRating || 0);
    const idA = teamA.id || teamA.name || 'A';
    const idB = teamB.id || teamB.name || 'B';
    const matchId = [idA, idB].sort().join('_');
    return `predict_${matchId}_${eloA}_${eloB}`;
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') return res.status(200).end();
    
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método no permitido. Usa POST.' });
    }

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { teamA, teamB, options = {} } = body || {};

        if (!teamA || !teamB || !teamA.name || !teamB.name) {
            return res.status(400).json({ error: 'Faltan objetos completos de teamA y/o teamB.' });
        }

        // ==========================================
        // PASO 1: MOTOR MATEMÁTICO (Base Prediction)
        // ==========================================
        const engineData = {
            teams: { [teamA.name]: teamA, [teamB.name]: teamB }
        };
        const engine = new MathEngine(engineData, 'standard');
        
        const mathPrediction = engine.predictMatch(teamA.name, teamB.name);
        if (!mathPrediction || mathPrediction.error) {
             return res.status(500).json({ error: mathPrediction?.error || 'Fallo al inicializar el Math Engine' });
        }

        // ==========================================
        // PASO 2: CACHÉ REDIS (KV)
        // ==========================================
        const cacheKey = generateCacheKey(teamA, teamB);
        let cachedResult = null;
        if (kv && !options.bypassCache) {
            try {
                cachedResult = await kv.get(cacheKey);
                if (cachedResult) {
                    return res.status(200).json({
                        ...cachedResult,
                        cacheHit: true,
                        mathContribution: 100 - (cachedResult.aiContribution || 0)
                    });
                }
            } catch (e) {
                console.warn('[api/predict] Redis error:', e.message);
            }
        }

        // ==========================================
        // PASO 3: GEMINI INTELLIGENCE LAYER
        // ==========================================
        let geminiFactors = null;
        let aiModelUsed = 'none';

        try {
            // fetchQuantitativeFactors recibe strings con los nombres para el prompt de IA
            geminiFactors = await fetchQuantitativeFactors(teamA.name, teamB.name);
            if (geminiFactors && geminiFactors.sources) {
                aiModelUsed = geminiFactors.modelUsed || 'gemini-fallback';
            }
        } catch (error) {
            console.warn('[api/predict] Gemini falló o hizo timeout, usando Math Engine puro:', error.message);
        }

        // ==========================================
        // PASO 4: VALIDATION LAYER
        // ==========================================
        let finalPrediction = mathPrediction;
        let aiContribution = 0;

        if (geminiFactors) {
            // El motor matemático aplica los factores.
            // Internamente ya está acotado al 10% según nuestra regla estricta (Paso 4).
            finalPrediction = engine.predictMatch(teamA.name, teamB.name, geminiFactors);
            
            // Calculamos cuánto varió la probabilidad final
            const deltaWinA = Math.abs(finalPrediction.winA - mathPrediction.winA);
            const deltaWinB = Math.abs(finalPrediction.winB - mathPrediction.winB);
            aiContribution = Math.round(deltaWinA + deltaWinB);
        }

        // ==========================================
        // PASO 5: PREPARAR AUDITORÍA Y RESPONSE
        // ==========================================
        const btts = finalPrediction.btts || 50; 
        const over25 = finalPrediction.over25 || 50;

        const finalResponse = {
            ...finalPrediction,
            success: true,
            teamA: teamA.name,
            teamB: teamB.name,
            winA: Math.round(finalPrediction.winA),
            draw: Math.round(finalPrediction.draw),
            winB: Math.round(finalPrediction.winB),
            btts: Math.round(btts),
            over25: Math.round(over25),
            under25: 100 - Math.round(over25),
            mathContribution: 100 - aiContribution,
            aiContribution: aiContribution,
            confidence: aiContribution > 0 ? 95 : 85,
            cacheHit: false,
            modelUsed: aiModelUsed,
            geminiAnalysis: geminiFactors ? geminiFactors.reasoning : 'Análisis matemático puro (IA offline).',
            timestamp: new Date().toISOString()
        };

        // Guardar asíncronamente en caché (TTL 12 horas)
        if (kv && !options.bypassCache) {
            try {
                kv.set(cacheKey, finalResponse, { ex: 43200 }).catch(e => console.warn('[api/predict] Redis save async error:', e.message));
            } catch(e) {
                console.warn('[api/predict] Redis save sync error:', e.message);
            }
        }

        // Auditoría asíncrona (Paso 5)
        const baseUrl = req.headers.host ? `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}` : 'http://localhost:3000';
        fetch(`${baseUrl}/api/audit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                match: `${teamA.name} vs ${teamB.name}`,
                baseProbabilities: { winA: mathPrediction.winA, draw: mathPrediction.draw, winB: mathPrediction.winB },
                finalProbabilities: finalResponse.probabilities,
                aiModifiers: geminiFactors || null,
                modelUsed: aiModelUsed
            })
        }).catch(e => console.warn('[api/predict] Audit error:', e.message));

        // ==========================================
        // PASO 6: RESPUESTA AL CLIENTE
        // ==========================================
        return res.status(200).json(finalResponse);

    } catch (error) {
        console.error('[api/predict] Error crítico:', error);
        return res.status(500).json({ error: error.message });
    }
};
