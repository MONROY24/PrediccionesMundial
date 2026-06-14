// Node.js Serverless — compatible con GeminiKeyManager, caché y Grounding
const PersistentGeminiCache = require('./lib/persistentCache');
const geminiKeyManager = require('./lib/GeminiKeyManager');

// Modelo Gemini actualizado a 3.5 Flash con Grounding
const GEMINI_MODEL = 'gemini-3.5-flash';

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
ELO: ${eloDiffText}
MARCADORES PROBABLES: ${topScoresText}
OVER 2.5: ${over25}% | BTTS: ${btts}%
${contextText}

Busca en internet noticias recientes de ambos equipos antes de analizar.
Genera un análisis experto y exhaustivo incluyendo:
1. Contexto histórico y táctico
2. Lesiones, sanciones o novedades recientes encontradas
3. Fortalezas y debilidades de cada equipo
4. Análisis de las probabilidades y modelo Poisson
5. Tu predicción final

Sé detallado y profesional. Usa formato markdown (negritas, subtítulos ##, listas).`;
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

        // Intentar con rotación de claves
        const MAX_KEY_ATTEMPTS = Math.max(geminiKeyManager.keys.length, 1);
        let lastError = null;
        let finalAnalysis = '';
        let finalFinishReason = 'STOP';
        let allSources = [];
        let succeeded = false;

        for (let keyAttempt = 0; keyAttempt < MAX_KEY_ATTEMPTS; keyAttempt++) {
            const keyObj = geminiKeyManager.getCurrentKey();

            if (!keyObj) {
                lastError = new Error('Todas las API Keys de Gemini están agotadas temporalmente. Intenta en unos minutos.');
                break;
            }

            const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${keyObj.value}`;
            let contents = [{ role: 'user', parts: [{ text: prompt }] }];
            let iterations = 0;
            const MAX_ITERATIONS = 4;
            let keyFailed = false;

            finalAnalysis = '';
            allSources = [];

            try {
                while (iterations < MAX_ITERATIONS) {
                    iterations++;

                    const geminiReqBody = {
                        contents,
                        tools: [{ googleSearch: {} }],
                        generationConfig: {
                            temperature: 0.7,
                            topK: 40,
                            topP: 0.95,
                            maxOutputTokens: 2048,
                        },
                        safetySettings: [
                            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
                        ]
                    };

                    const response = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(geminiReqBody)
                    });

                    const data = await response.json();

                    if (!response.ok) {
                        const errCode = data.error?.code;
                        const errMsg = data.error?.message || 'Error desconocido';
                        // 429 = quota exceeded → rotar clave
                        if (errCode === 429 || errCode === 'RESOURCE_EXHAUSTED' || errMsg.includes('quota')) {
                            console.warn(`[analyze] Key ${keyObj.display} agotada (${errCode}). Rotando...`);
                            geminiKeyManager.markKeyAsFailed(keyObj);
                            keyFailed = true;
                            lastError = new Error(`Gemini API Error: ${errMsg}`);
                            break;
                        }
                        throw new Error(`Gemini API Error (${errCode}): ${errMsg}`);
                    }

                    // Extraer grounding chunks
                    const chunks = data.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
                    chunks.forEach(chunk => {
                        if (chunk.web?.uri && !allSources.includes(chunk.web.uri)) {
                            allSources.push(chunk.web.uri);
                        }
                    });

                    const textChunk = data.candidates?.[0]?.content?.parts?.[0]?.text;
                    const finishReason = data.candidates?.[0]?.finishReason;

                    if (!textChunk) {
                        if (finalAnalysis === '') throw new Error(`Respuesta vacía de Gemini. Razón: ${finishReason || 'desconocida'}`);
                        break;
                    }

                    finalAnalysis += textChunk;
                    finalFinishReason = finishReason;

                    if (finishReason === 'MAX_TOKENS' && iterations < MAX_ITERATIONS) {
                        contents.push({ role: 'model', parts: [{ text: textChunk }] });
                        contents.push({ role: 'user', parts: [{ text: 'Continúa el análisis exactamente donde te quedaste, de forma fluida, sin repetir el texto anterior y sin introducciones.' }] });
                    } else {
                        break;
                    }
                }

                if (!keyFailed) {
                    succeeded = true;
                    break; // Salir del loop de claves — tuvo éxito
                }

            } catch (innerError) {
                lastError = innerError;
                if (innerError.message.includes('quota') || innerError.message.includes('429')) {
                    geminiKeyManager.markKeyAsFailed(keyObj);
                } else {
                    throw innerError; // Error no relacionado con quota → propagar
                }
            }
        }

        if (!succeeded) {
            throw lastError || new Error('No se pudo completar el análisis con ninguna API Key disponible.');
        }

        const responseData = {
            success: true,
            analysis: finalAnalysis,
            finishReason: finalFinishReason,
            teamA,
            teamB,
            probabilities: prediction,
            generatedAt: new Date().toISOString(),
            model: GEMINI_MODEL,
            isCached: false,
            sources: allSources
        };

        // Guardar en caché por 24 horas asíncronamente
        PersistentGeminiCache.setCachedAnalysis(cacheKey, responseData, 24).catch(e => console.error(e));

        return res.status(200).json(responseData);

    } catch (error) {
        console.error('[analyze] Error:', error.message);
        return res.status(500).json({
            error: `Gemini API Error: ${error.message}`,
            details: error.message,
            code: 'GEMINI_ERROR'
        });
    }
};