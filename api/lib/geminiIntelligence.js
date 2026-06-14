const GEMINI_MODEL = 'gemini-3.1-flash-lite';

// Simple memory cache para minimizar llamadas repetidas durante una sesión (Vercel Free)
const intelligenceCache = {};

function buildQuantitativePrompt(teamA, teamB) {
    return `Eres un Analista Profesional Cuantitativo de selecciones nacionales de fútbol.
No eres un narrador deportivo. Tu objetivo es proveer señales estructuradas para un motor matemático.

Analiza el ENFRENTAMIENTO DIRECTO (Matchup) entre: ${teamA} vs ${teamB}.
Debes evaluarlos como una única unidad interactiva, no de forma aislada.
Considera:
- Diferencias tácticas y estilos de juego
- Fortalezas ofensivas vs Fortalezas defensivas
- Vulnerabilidades específicas que el rival puede explotar
- Enfrentamientos recientes y compatibilidad táctica
- Lesiones o sanciones recientes (solo si hay evidencia clara)
- Considera el peso de la información (ej. lesiones pesan 35%, táctica 15%, etc.) en tu evaluación global de ajuste.

Reglas estrictas:
1. Responde ÚNICAMENTE con un objeto JSON válido.
2. No agregues texto fuera del JSON (ni saludos, ni markdown de \`\`\`json).
3. Evalúa "teamAAdjustment" y "teamBAdjustment" del -10 (muy negativo) al +10 (muy positivo). 0 es neutral.
4. "tacticalEdge" debe ser entre -10 y +10. Un valor positivo favorece a ${teamA}, un valor negativo favorece a ${teamB}.
5. "confidence" debe ser un entero entre 0 y 100 indicando qué tan seguro estás de la información actual de este enfrentamiento.
6. Nunca asumir lesiones, sanciones o conflictos sin evidencia clara.

Formato requerido:
{
  "teamAAdjustment": 0,
  "teamBAdjustment": 0,
  "tacticalEdge": 0,
  "confidence": 0,
  "reasoning": "Breve explicación analítica del enfrentamiento."
}`;
}

// Validar rangos, corregir automáticamente y registrar advertencia
function sanitizeGeminiFactors(factors, teamA, teamB) {
    const matchupName = `${teamA} vs ${teamB}`;
    const sanitizeValue = (val, min, max, defaultVal, factorName) => {
        let num = Number(val);
        if (isNaN(num)) {
            console.warn(`[Gemini Engine] Invalid value for ${factorName} on ${matchupName}. Expected number, got ${val}. Resetting to ${defaultVal}.`);
            return defaultVal;
        }
        if (num < min || num > max) {
            console.warn(`[Gemini Engine] Out of range value for ${factorName} on ${matchupName}: ${num}. Clamping to [${min}, ${max}].`);
            return Math.max(min, Math.min(max, num));
        }
        return num;
    };

    return {
        teamAAdjustment: sanitizeValue(factors?.teamAAdjustment, -10, 10, 0, 'teamAAdjustment'),
        teamBAdjustment: sanitizeValue(factors?.teamBAdjustment, -10, 10, 0, 'teamBAdjustment'),
        tacticalEdge: sanitizeValue(factors?.tacticalEdge, -10, 10, 0, 'tacticalEdge'),
        confidence: sanitizeValue(factors?.confidence, 0, 100, 0, 'confidence'),
        reasoning: factors?.reasoning || 'No reasoning provided.'
    };
}

// Si JSON es inválido: usar valores neutrales.
function validateGeminiResponse(text, teamA, teamB) {
    try {
        const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const factors = JSON.parse(cleanText);
        return sanitizeGeminiFactors(factors, teamA, teamB);
    } catch (e) {
        console.warn(`[Gemini Engine] Invalid JSON from Gemini for ${teamA} vs ${teamB}. Using neutral values. Error: ${e.message}`);
        return sanitizeGeminiFactors({}, teamA, teamB);
    }
}

const geminiKeyManager = require('./GeminiKeyManager');

async function fetchQuantitativeFactors(teamA, teamB) {
    const matchupName = `${teamA} vs ${teamB}`;
    
    const strictCacheKey = `${teamA}_vs_${teamB}`;
    if (intelligenceCache[strictCacheKey]) {
        return intelligenceCache[strictCacheKey];
    }

    const prompt = buildQuantitativePrompt(teamA, teamB);
    const body = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
            temperature: 0.2, 
            topK: 40,
            topP: 0.95,
            response_mime_type: "application/json" 
        }
    };

    let attempts = 0;
    const maxAttempts = geminiKeyManager.keys.length > 0 ? geminiKeyManager.keys.length : 1;

    while (attempts < maxAttempts) {
        const keyObj = geminiKeyManager.getCurrentKey();
        
        if (!keyObj) {
            console.warn(`[Gemini Engine] No hay claves activas disponibles para ${matchupName}. Usando neutrales.`);
            return validateGeminiResponse("{}", teamA, teamB);
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${keyObj.value}`;

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            const data = await response.json();

            if (!response.ok) {
                const isQuotaError = response.status === 429 || 
                                     (data.error && data.error.message && data.error.message.toLowerCase().includes('quota')) ||
                                     (data.error && data.error.message && data.error.message.toLowerCase().includes('exhausted')) ||
                                     (data.error && data.error.message && data.error.message.toLowerCase().includes('rate limit'));
                                     
                if (isQuotaError) {
                    geminiKeyManager.markKeyAsFailed(keyObj);
                    attempts++;
                    continue; // Intentar con la siguiente clave
                } else {
                    // Error distinto (ej: 400 Bad Request), no quemamos la clave
                    console.warn(`[Gemini Engine] API Error (${response.status}): ${data.error?.message}. Usando neutrales para ${matchupName}.`);
                    return validateGeminiResponse("{}", teamA, teamB);
                }
            }

            const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!text) {
                console.warn(`[Gemini Engine] Respuesta vacía de Gemini para ${matchupName}. Usando neutrales.`);
                return validateGeminiResponse("{}", teamA, teamB);
            }

            const factors = validateGeminiResponse(text, teamA, teamB);
            
            intelligenceCache[strictCacheKey] = factors;
            return factors;

        } catch (e) {
            console.warn(`[Gemini Engine] Error crítico llamando a Gemini para ${matchupName} con clave ${keyObj.display}: ${e.message}.`);
            // Error de red
            attempts++;
            geminiKeyManager.rotateKey(); 
        }
    }

    console.warn(`[Gemini Engine] Todos los reintentos (${maxAttempts}) fallaron para ${matchupName}. Usando neutrales.`);
    return validateGeminiResponse("{}", teamA, teamB);
}

module.exports = {
    fetchQuantitativeFactors,
    intelligenceCache,
    sanitizeGeminiFactors,
    validateGeminiResponse
};
