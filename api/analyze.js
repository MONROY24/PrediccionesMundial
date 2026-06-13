// ============================================================
// API/ANALYZE.JS — Gemini Analysis Endpoint
// POST /api/analyze
// Recibe: { teamA, teamB, prediction, contextualFactors }
// Devuelve: { analysis, generatedAt }
//
// SEGURIDAD: GEMINI_API_KEY NUNCA se expone al browser.
// Esta función solo corre en el servidor Vercel (Node.js).
// ============================================================

const https = require('https');

// Modelo Gemini — gemini-2.5-flash: requerido por la API Key del usuario
const GEMINI_MODEL = 'gemini-2.5-flash';

// Cache en memoria para evitar llamadas duplicadas por el mismo partido
// (Se reinicia en cada cold start del serverless function)
const _analysisCache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutos

/**
 * Construye el prompt estructurado para Gemini.
 * Gemini RECIBE probabilidades del motor pero NO las modifica.
 * Solo genera análisis textual.
 */
function buildPrompt(teamA, teamB, prediction, contextualFactors = {}) {
    const { winA, draw, winB, mostLikelyScore, lambdaA, lambdaB,
            topScores = [], over25, btts, eloDiff } = prediction;

    const topScoresText = topScores.slice(0, 5)
        .map(s => `${s.score} (${s.probability}%)`)
        .join(' | ');

    const eloDiffText = eloDiff > 0
        ? `${teamA} superior por ${Math.abs(eloDiff)} puntos ELO`
        : eloDiff < 0
        ? `${teamB} superior por ${Math.abs(eloDiff)} puntos ELO`
        : 'Equipos parejos en ELO';

    const contextText = Object.keys(contextualFactors).length > 0
        ? `\nFACTORES CONTEXTUALES ADICIONALES:\n${
            Object.entries(contextualFactors)
              .filter(([,v]) => v)
              .map(([k, v]) => `- ${k}: ${v}`)
              .join('\n')
          }`
        : '';

    return `Eres analista experto del Mundial FIFA 2026. Responde en español con markdown.

PARTIDO: ${teamA} vs ${teamB}
PROBABILIDADES: ${teamA} ${winA}% | Empate ${draw}% | ${teamB} ${winB}%
GOLES ESPERADOS: λ${teamA}=${lambdaA} | λ${teamB}=${lambdaB} | Total=${(parseFloat(lambdaA)+parseFloat(lambdaB)).toFixed(2)}
Genera un análisis experto muy breve (MÁXIMO 3 PÁRRAFOS CORTOS) incluyendo:
1. Táctica clave de cada equipo
2. Análisis rápido de las probabilidades
3. Tu predicción final

Sé extremadamente conciso. No superes los 250 palabras en total o el sistema cortará tu respuesta.`;
}

/**
 * Llama a la API de Gemini vía HTTPS nativo de Node.js.
 * No requiere dependencias externas.
 */
function callGemini(prompt, apiKey) {
    return new Promise((resolve, reject) => {
        const bodyObj = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.7,
                topK: 40,
                topP: 0.95,
                maxOutputTokens: 850,
            },
            safetySettings: [
                { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
            ]
        };

        const body = JSON.stringify(bodyObj);
        const path = `/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

        const options = {
            hostname: 'generativelanguage.googleapis.com',
            port: 443,
            path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);

                    // Manejar error de la API de Gemini
                    if (parsed.error) {
                        return reject(new Error(`Gemini API Error (${parsed.error.code}): ${parsed.error.message}`));
                    }

                    const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (!text) {
                        const reason = parsed.candidates?.[0]?.finishReason;
                        return reject(new Error(`Respuesta vacía de Gemini. Razón: ${reason || 'desconocida'}`));
                    }

                    resolve(text);
                } catch (e) {
                    reject(new Error(`Error parseando respuesta de Gemini: ${e.message}`));
                }
            });
        });

        req.on('error', (e) => reject(new Error(`Error de red al llamar Gemini: ${e.message}`)));
        req.setTimeout(9200, () => {
            req.destroy();
            reject(new Error('TIMEOUT_VERCEL: Gemini tardó más de 9 segundos en responder.'));
        });

        req.write(body);
        req.end();
    });
}

// ============================================================
// HANDLER PRINCIPAL
// ============================================================
module.exports = async (req, res) => {
    // Headers CORS (el frontend está en el mismo dominio Vercel, pero por si acaso)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método no permitido. Usa POST.' });
    }

    // Verificar API Key en servidor
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
        console.error('[analyze] GEMINI_API_KEY no configurada en variables de entorno de Vercel');
        return res.status(503).json({
            error: 'El servicio de análisis IA no está configurado. El administrador debe agregar GEMINI_API_KEY en Vercel.',
            code: 'MISSING_API_KEY'
        });
    }

    try {
        const { teamA, teamB, prediction, contextualFactors = {} } = req.body || {};

        // Validar parámetros
        if (!teamA || !teamB) {
            return res.status(400).json({ error: 'Faltan parámetros: teamA y teamB son requeridos.' });
        }
        if (!prediction || typeof prediction.winA === 'undefined') {
            return res.status(400).json({ error: 'Falta prediction con winA, draw, winB.' });
        }

        // Revisar cache
        const cacheKey = `${teamA}_${teamB}_${prediction.winA}_${prediction.winB}`;
        const cached = _analysisCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
            console.log(`[analyze] Cache hit: ${cacheKey}`);
            return res.status(200).json({
                ...cached.data,
                fromCache: true
            });
        }

        // Llamar a Gemini
        console.log(`[analyze] Llamando Gemini para ${teamA} vs ${teamB}`);
        const prompt = buildPrompt(teamA, teamB, prediction, contextualFactors);
        const analysisText = await callGemini(prompt, GEMINI_API_KEY);

        const responseData = {
            success: true,
            analysis: analysisText,
            teamA,
            teamB,
            probabilities: {
                winA: prediction.winA,
                draw: prediction.draw,
                winB: prediction.winB,
                mostLikelyScore: prediction.mostLikelyScore
            },
            generatedAt: new Date().toISOString(),
            model: GEMINI_MODEL
        };

        // Guardar en cache
        _analysisCache.set(cacheKey, { data: responseData, timestamp: Date.now() });

        // Limpiar cache antiguo (máximo 50 entradas)
        if (_analysisCache.size > 50) {
            const firstKey = _analysisCache.keys().next().value;
            _analysisCache.delete(firstKey);
        }

        return res.status(200).json(responseData);

    } catch (error) {
        console.error('[analyze] Error:', error.message);
        return res.status(500).json({
            error: `Error IA: ${error.message}`,
            details: error.message,
            code: 'GEMINI_ERROR'
        });
    }
};