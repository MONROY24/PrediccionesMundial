// Node.js Serverless — compatible con GeminiKeyManager, caché y Grounding
const PersistentGeminiCache = require('./_lib/persistentCache');
const geminiKeyManager = require('./_lib/GeminiKeyManager');

const { GeminiReliabilityEngine, GeminiStatus } = require('./_lib/GeminiReliabilityEngine');
const GeminiDiagnosticsEngine = require('./_lib/GeminiDiagnosticsEngine');

const GEMINI_MODELS = [
    'gemini-3.5-flash',       // MODEL_PRIMARY
    'gemini-2.5-flash',       // MODEL_FALLBACK
    'gemini-1.5-flash',       // MODEL_LEGACY
    'gemini-3.1-flash-lite'   // MODEL_EMERGENCY
];

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

    return `Eres un analista deportivo experto del Mundial FIFA 2026. Escribe ÚNICAMENTE en español usando formato markdown profesional.

## DATOS DEL PARTIDO
- **Enfrentamiento:** ${teamA} vs ${teamB}
- **Probabilidades:** ${teamA} ${winA}% | Empate ${draw}% | ${teamB} ${winB}%
- **Goles esperados:** λ${teamA}=${lambdaA} | λ${teamB}=${lambdaB} | Total=${(parseFloat(lambdaA)+parseFloat(lambdaB)).toFixed(2)}
- **ELO:** ${eloDiffText}
- **Marcadores más probables:** ${topScoresText}
- **Over 2.5:** ${over25}% | **BTTS:** ${btts}%
${contextText}

## INSTRUCCIONES
Escribe un análisis exhaustivo y detallado con las siguientes secciones, en este orden exacto:

### 1. Contexto Histórico y Rivalidad
### 2. Situación Actual y Novedades (lesiones, sanciones, forma reciente)
### 3. Análisis Táctico (fortalezas y debilidades de cada equipo)
### 4. Interpretación Estadística (probabilidades Poisson y modelo matemático)
### 5. Predicción Final

Sé muy detallado en cada sección. No incluyas texto introductorio antes de comenzar las secciones.`;
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método no permitido. Usa POST.' });
    }

    // Verificar que hay al menos una key disponible
    const availableKeys = geminiKeyManager.getAvailableKeys();
    if (availableKeys.length === 0 && geminiKeyManager.keys.length === 0) {
        return res.status(503).json({
            error: 'El servicio de análisis IA no está configurado. Agrega GEMINI_API_KEY en Vercel.',
            code: 'MISSING_API_KEY'
        });
    }

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { teamA, teamB, prediction, contextualFactors = {} } = body || {};

        if (!teamA || !teamB || !prediction || typeof prediction.winA === 'undefined') {
            return res.status(400).json({ error: 'Faltan parámetros requeridos.' });
        }

        const prompt = buildPrompt(teamA, teamB, prediction, contextualFactors);

        // Verificar caché primero
        const cacheKey = `analysis_${teamA}_${teamB}`;
        const cachedAnalysis = await PersistentGeminiCache.getCachedAnalysis(cacheKey);
        if (cachedAnalysis) {
            GeminiDiagnosticsEngine.recordDiagnostic({
                timestamp: new Date().toISOString(),
                match: `${teamA} vs ${teamB}`,
                model: 'cached',
                apiKeyIndex: -1,
                responseTime: 0,
                cacheHit: true,
                cacheMiss: false,
                retryCount: 0,
                groundingUsed: false,
                groundingSuccess: false,
                status: 'SUCCESS'
            }).catch(e => console.error(e));

            return res.status(200).json({
                success: true,
                analysis: cachedAnalysis.analysis,
                finishReason: (cachedAnalysis.finishReason || 'CACHED') + ' (Cached)',
                teamA,
                teamB,
                probabilities: prediction,
                isCached: true,
                sources: cachedAnalysis.sources || []
            });
        }

        let contents = [{ role: 'user', parts: [{ text: prompt }] }];
        let finalAnalysis = '';
        let allSources = [];
        let useGrounding = true;
        let isFallback = false;
        let currentModelIndex = 0;
        let usedModelStr = GEMINI_MODELS[0];
        let totalLatency = 0;
        let usedTools = [];
        
        let continuations = 0;
        const MAX_CONTINUATIONS = 3;

        while (continuations < MAX_CONTINUATIONS) {
            continuations++;
            
            const result = await GeminiReliabilityEngine.executeGeminiRequest(async (attempt, lastStatus) => {
                let keyObj = geminiKeyManager.getCurrentKey();
                if (!keyObj) return null; // Abortar si no hay keys
                
                if (lastStatus === GeminiStatus.MODEL_NOT_FOUND || lastStatus === GeminiStatus.COMPATIBILITY_ERROR) {
                    currentModelIndex++;
                    if (currentModelIndex >= GEMINI_MODELS.length) {
                        return null; // Ya probamos todos los modelos
                    }
                    console.warn(`[Analyze] Fallo en modelo actual, cambiando a: ${GEMINI_MODELS[currentModelIndex]}`);
                } else if (lastStatus === GeminiStatus.MODEL_ERROR || lastStatus === GeminiStatus.TIMEOUT) {
                    geminiKeyManager.recordError(keyObj, 'general');
                } else if (lastStatus === GeminiStatus.QUOTA_EXCEEDED || lastStatus === GeminiStatus.RATE_LIMIT) {
                    if (useGrounding) {
                        useGrounding = false; // Fallback 1: remover grounding
                    } else {
                        geminiKeyManager.recordError(keyObj, 'quota');
                        useGrounding = true;
                        currentModelIndex = 0; // Intentar desde el mejor modelo con la nueva key
                        keyObj = geminiKeyManager.getCurrentKey();
                        if (!keyObj) return null;
                    }
                } else if (lastStatus === GeminiStatus.INVALID_RESPONSE && useGrounding) {
                    useGrounding = false;
                }
                
                const model = GEMINI_MODELS[currentModelIndex];
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${keyObj.value}`;
                
                const reqBody = {
                    contents,
                    ...(useGrounding ? { tools: [{ googleSearch: {} }] } : {}),
                    generationConfig: {
                        temperature: 0.7,
                        topK: 40,
                        topP: 0.95,
                        maxOutputTokens: 4096,
                    },
                    safetySettings: [
                        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
                    ]
                };
                return { url, body: reqBody, model, keyObj };
            }, { MAX_RETRIES: 2, REQUEST_TIMEOUT_MS: 10000 });

            if (result.status === GeminiStatus.SUCCESS) {
                if (result.keyObj) geminiKeyManager.recordSuccess(result.keyObj, result.latency);
                finalAnalysis += result.text;
                allSources.push(...result.sources);
                usedModelStr = result.modelUsed;
                totalLatency += result.latency || 0;
                usedTools = result.toolsUsed || [];
                
                if (result.finishReason === 'MAX_TOKENS') {
                    contents.push({ role: 'model', parts: [{ text: result.text }] });
                    contents.push({ role: 'user', parts: [{ text: 'Continua escribiendo exactamente desde donde cortaste, sin repetir nada de lo anterior, sin titulo, sin introducción.' }] });
                    continue; // Siguiente iteración del MAX_TOKENS
                }
                break; // Terminó correctamente
            } else {
                isFallback = true;
                break;
            }
        }

        if (isFallback || !finalAnalysis) {
            // Requisito: Nunca bloquear la predicción. Usar fallback amigable.
            return res.status(200).json({
                success: true,
                analysis: "El análisis de IA avanzado no está disponible en este momento debido a alta demanda. No obstante, las probabilidades generadas por el motor matemático son correctas y puede confiar en ellas.",
                finishReason: 'FALLBACK',
                teamA,
                teamB,
                probabilities: prediction,
                isFallback: true,
                sources: []
            });
        }

        const responseData = {
            success: true,
            analysis: finalAnalysis,
            finishReason: 'STOP',
            teamA,
            teamB,
            probabilities: prediction,
            generatedAt: new Date().toISOString(),
            model: usedModelStr,
            isCached: false,
            sources: [...new Set(allSources)],
            latency: `${totalLatency}ms`,
            toolsUsed: usedTools
        };

        // Guardar en caché por 24 horas asíncronamente
        PersistentGeminiCache.setCachedAnalysis(cacheKey, responseData, 24).catch(e => console.error(e));

        // Registrar telemetría asíncronamente
        GeminiDiagnosticsEngine.recordDiagnostic({
            timestamp: new Date().toISOString(),
            match: `${teamA} vs ${teamB}`,
            model: usedModelStr,
            apiKeyIndex: geminiKeyManager.currentKeyIndex !== undefined ? geminiKeyManager.currentKeyIndex : -1,
            responseTime: totalLatency,
            cacheHit: false,
            cacheMiss: true,
            retryCount: continuations - 1,
            groundingUsed: usedTools.includes('googleSearch'),
            groundingSuccess: !isFallback && usedTools.includes('googleSearch'),
            status: isFallback ? 'ERROR' : 'SUCCESS'
        }).catch(e => console.error(e));

        return res.status(200).json(responseData);

    } catch (error) {
        console.error('[analyze] Error Fatal:', error.message);
        // Fallback seguro ante cualquier otra eventualidad
        return res.status(200).json({
            success: true,
            analysis: "Error inesperado en el motor de IA. Visualizando datos matemáticos predictivos.",
            isFallback: true,
            sources: []
        });
    }
};