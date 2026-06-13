export const config = {
    runtime: 'edge',
};

// Modelo Gemini — gemini-1.5-flash: requerido por la API Key del usuario
const GEMINI_MODEL = 'gemini-1.5-flash';

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

Genera un análisis experto y exhaustivo de este partido incluyendo:
1. Contexto histórico y táctico del partido
2. Fortalezas y debilidades de cada equipo
3. Análisis profundo de las probabilidades y Poisson
4. Tu predicción final

No tienes límite de palabras, sé detallado y profesional. Usa formato markdown (negritas, subtítulos ##, listas) para hacerlo fácil de leer.`;
}

export default async function handler(req) {
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            status: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            }
        });
    }

    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Método no permitido. Usa POST.' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
    }

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
        return new Response(JSON.stringify({
            error: 'El servicio de análisis IA no está configurado. El administrador debe agregar GEMINI_API_KEY en Vercel.',
            code: 'MISSING_API_KEY'
        }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    }

    try {
        const body = await req.json();
        const { teamA, teamB, prediction, contextualFactors = {} } = body;

        if (!teamA || !teamB || !prediction || typeof prediction.winA === 'undefined') {
            return new Response(JSON.stringify({ error: 'Faltan parámetros requeridos.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        const prompt = buildPrompt(teamA, teamB, prediction, contextualFactors);

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
        
        let contents = [{ role: 'user', parts: [{ text: prompt }] }];
        let finalAnalysis = "";
        let finalFinishReason = "STOP";
        let iterations = 0;
        const MAX_ITERATIONS = 4;

        while (iterations < MAX_ITERATIONS) {
            iterations++;
            
            const geminiReqBody = {
                contents: contents,
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
                throw new Error(`Gemini API Error (${data.error?.code}): ${data.error?.message}`);
            }

            const textChunk = data.candidates?.[0]?.content?.parts?.[0]?.text;
            const finishReason = data.candidates?.[0]?.finishReason;
            
            if (!textChunk) {
                if (finalAnalysis === "") throw new Error(`Respuesta vacía de Gemini. Razón: ${finishReason || 'desconocida'}`);
                break;
            }

            finalAnalysis += textChunk;
            finalFinishReason = finishReason;

            // Si se detuvo por MAX_TOKENS y aún no alcanzamos el límite de iteraciones, pedimos continuación
            if (finishReason === 'MAX_TOKENS' && iterations < MAX_ITERATIONS) {
                contents.push({ role: 'model', parts: [{ text: textChunk }] });
                contents.push({ role: 'user', parts: [{ text: "Continúa el análisis exactamente donde te quedaste, de forma fluida, sin repetir el texto anterior y sin introducciones." }] });
            } else {
                break; // Terminó correctamente o por otra razón (ej. SAFETY)
            }
        }

        const responseData = {
            success: true,
            analysis: finalAnalysis,
            finishReason: finalFinishReason + ` (Iteraciones: ${iterations})`,
            teamA,
            teamB,
            probabilities: prediction,
            generatedAt: new Date().toISOString(),
            model: GEMINI_MODEL
        };

        return new Response(JSON.stringify(responseData), {
            status: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            }
        });

    } catch (error) {
        console.error('[analyze edge] Error:', error.message);
        return new Response(JSON.stringify({
            error: `Error IA: ${error.message}`,
            details: error.message,
            code: 'GEMINI_ERROR'
        }), {
            status: 500,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            }
        });
    }
}