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

// Modelo Gemini — gemini-2.0-flash: rápido, gratuito, multilingüe
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

    return `Eres el analista jefe de fútbol internacional del Predictor Mundial 2026, con acceso al motor matemático más avanzado disponible. Tu análisis debe ser experto, apasionado y preciso.

═══════════════════════════════════════
DATOS DEL PARTIDO — MUNDIAL FIFA 2026
═══════════════════════════════════════
Partido: ${teamA} vs ${teamB}

PROBABILIDADES (Motor Poisson-Dixon-Coles v5.0):
  • Victoria ${teamA}: ${winA}%
  • Empate: ${draw}%
  • Victoria ${teamB}: ${winB}%

GOLES ESPERADOS (λ de Poisson):
  • λ${teamA} = ${lambdaA} goles
  • λ${teamB} = ${lambdaB} goles
  • Total esperado: ${(parseFloat(lambdaA) + parseFloat(lambdaB)).toFixed(2)} goles

MARCADORES MÁS PROBABLES:
  ${topScoresText}

MERCADOS DE APUESTA:
  • Over 2.5 goles: ${over25}%
  • Ambos Anotan (BTTS): ${btts}%

CONTEXTO ELO:
  ${eloDiffText}
${contextText}

═══════════════════════════════════════
INSTRUCCIONES DE ANÁLISIS
═══════════════════════════════════════

Genera un informe completo en español con las siguientes secciones (usa markdown):

## 📋 Análisis del Partido
[3 párrafos: contexto histórico de este enfrentamiento, expectativas tácticas, 
y qué define este partido en el Mundial 2026]

## 💪 Fortalezas de ${teamA}
[4 puntos específicos con datos concretos]

## ⚠️ Debilidades de ${teamA}
[2-3 puntos honestos]

## 💪 Fortalezas de ${teamB}
[4 puntos específicos con datos concretos]

## ⚠️ Debilidades de ${teamB}
[2-3 puntos honestos]

## 🔢 Por Qué Estas Probabilidades
[Explica en términos accesibles por qué el modelo asigna ${winA}% a ${teamA}, 
${draw}% empate y ${winB}% a ${teamB}. Relaciona con λ de Poisson]

## 🎬 Escenarios Alternativos
[3 escenarios: Sorpresa grande, Resultado esperado, Partido cerrado que va a penales]

## 🏆 Veredicto del Analista
[Un párrafo contundente y memorable con tu predicción final y por qué]

Usa emojis estratégicamente. Sé específico, técnico pero accesible. Todo en español.
Limita a ~800 palabras totales para mantener frescura y precisión.`;
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
                temperature: 0.75,
                topK: 40,
                topP: 0.95,
                maxOutputTokens: 1800,
            },
            safetySettings: [
                { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
                { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' }
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
        req.setTimeout(25000, () => {
            req.destroy();
            reject(new Error('Timeout: Gemini tardó más de 25 segundos'));
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
            error: 'Error generando análisis IA. Por favor intenta nuevamente.',
            details: error.message,
            code: 'GEMINI_ERROR'
        });
    }
};
