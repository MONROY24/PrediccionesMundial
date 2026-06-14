const GEMINI_MODEL = 'gemini-3.5-flash';

const PersistentGeminiCache = require('./persistentCache');

function buildQuantitativePrompt(teamA, teamB) {
    return `Eres un Analista Profesional Cuantitativo de selecciones nacionales de fútbol.
No eres un narrador deportivo. Tu objetivo es proveer señales estructuradas para un motor matemático.

Analiza el ENFRENTAMIENTO DIRECTO (Matchup) entre: ${teamA} vs ${teamB}.
Debes evaluarlos como una única unidad interactiva, no de forma aislada.
Considera e investiga en internet:
- Diferencias tácticas y estilos de juego recientes
- Fortalezas ofensivas vs Fortalezas defensivas
- Vulnerabilidades específicas que el rival puede explotar
- Lesiones o sanciones recientes de jugadores clave
- Convocatorias de último minuto o ausencias notables
- Cambios recientes de entrenador
- Motivación y presión psicológica (historia, localía, etc.)
- Química del equipo (problemas internos conocidos, etc.)

Reglas estrictas:
1. IMPORTANTE: Utiliza la herramienta de búsqueda en internet (Grounding) para basar tu análisis en información actualizada y verificada. Limita tus búsquedas y criterios a medios de periodismo deportivo confiables.
2. Responde ÚNICAMENTE con un objeto JSON válido.
3. No agregues texto fuera del JSON (ni saludos, ni markdown de \`\`\`json).
3. Evalúa individualmente para CADA EQUIPO los siguientes factores con un puntaje entero del -10 (muy negativo/perjudicial) al +10 (muy positivo/favorable). 0 es neutral.
4. "tacticalEdge" debe ser entre -10 y +10. Un valor positivo favorece a ${teamA}, un valor negativo favorece a ${teamB}.
5. "confidence" debe ser un entero entre 0 y 100 indicando qué tan seguro estás de la información actual de este enfrentamiento.
6. Nunca asumir lesiones, sanciones o conflictos sin evidencia clara.

Formato requerido:
{
  "teamA": {
    "injury": 0,
    "suspension": 0,
    "coach": 0,
    "tactical": 0,
    "motivation": 0,
    "chemistry": 0
  },
  "teamB": {
    "injury": 0,
    "suspension": 0,
    "coach": 0,
    "tactical": 0,
    "motivation": 0,
    "chemistry": 0
  },
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

    const sanitizeTeamFactors = (teamObj, teamName) => {
        const obj = teamObj || {};
        return {
            injury: sanitizeValue(obj.injury, -10, 10, 0, `${teamName}.injury`),
            suspension: sanitizeValue(obj.suspension, -10, 10, 0, `${teamName}.suspension`),
            coach: sanitizeValue(obj.coach, -10, 10, 0, `${teamName}.coach`),
            tactical: sanitizeValue(obj.tactical, -10, 10, 0, `${teamName}.tactical`),
            motivation: sanitizeValue(obj.motivation, -10, 10, 0, `${teamName}.motivation`),
            chemistry: sanitizeValue(obj.chemistry, -10, 10, 0, `${teamName}.chemistry`)
        };
    };

    return {
        teamA: sanitizeTeamFactors(factors?.teamA, 'teamA'),
        teamB: sanitizeTeamFactors(factors?.teamB, 'teamB'),
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
    
    const strictCacheKey = `quant_${teamA}_vs_${teamB}`;
    const cachedData = await PersistentGeminiCache.getCachedAnalysis(strictCacheKey);
    if (cachedData) {
        return cachedData;
    }

    const prompt = buildQuantitativePrompt(teamA, teamB);
    let useGrounding = true; // Intentar con Grounding primero

    let attempts = 0;
    const maxAttempts = (geminiKeyManager.keys.length > 0 ? geminiKeyManager.keys.length : 1) * 2; // *2 para cubrir intentos con y sin Grounding

    while (attempts < maxAttempts) {
        const keyObj = geminiKeyManager.getCurrentKey();
        
        if (!keyObj) {
            console.warn(`[Gemini Engine] No hay claves activas disponibles para ${matchupName}. Usando neutrales.`);
            return validateGeminiResponse("{}", teamA, teamB);
        }

        const body = {
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            ...(useGrounding ? { tools: [{ googleSearch: {} }] } : {}),
            generationConfig: {
                temperature: 0.2, 
                topK: 40,
                topP: 0.95,
                // IMPORTANTE: response_mime_type: 'application/json' es incompatible
                // con tools: googleSearch. Solo se activa cuando NO hay Grounding.
                ...(useGrounding ? {} : { response_mime_type: 'application/json' })
            }
        };

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
                                     String(response.status) === '429' ||
                                     (data.error?.message?.toLowerCase().includes('quota')) ||
                                     (data.error?.message?.toLowerCase().includes('exhausted')) ||
                                     (data.error?.message?.toLowerCase().includes('rate limit'));

                // 503 = modelo saturado → esperar y reintentar
                const isOverloadError = response.status === 503 || 
                                        (data.error?.message?.toLowerCase().includes('high demand')) ||
                                        (data.error?.message?.toLowerCase().includes('overloaded')) ||
                                        (data.error?.message?.toLowerCase().includes('temporarily unavailable'));

                if (isOverloadError) {
                    const waitMs = 2000 * (attempts + 1);
                    console.warn(`[Gemini Engine] Modelo saturado (503) para ${matchupName}. Esperando ${waitMs}ms...`);
                    await new Promise(r => setTimeout(r, waitMs));
                    attempts++;
                    continue; // Reintentar sin rotar key ni cambiar Grounding
                }
                     
                if (isQuotaError) {
                    if (useGrounding) {
                        // Fallback: desactivar Grounding y reintentar con la MISMA key
                        console.warn(`[Gemini Engine] Cuota con Grounding en key ${keyObj.display}. Reintentando sin Grounding...`);
                        useGrounding = false;
                        attempts++;
                        continue;
                    }
                    // Sin Grounding también falla → rotar key
                    console.warn(`[Gemini Engine] Cuota agotada en key ${keyObj.display}. Rotando...`);
                    geminiKeyManager.markKeyAsFailed(keyObj);
                    useGrounding = true; // Volver a intentar Grounding con la nueva key
                    attempts++;
                    continue;
                } else {
                    // Error distinto (ej: 400 Bad Request), no quemamos la clave
                    console.warn(`[Gemini Engine] API Error (${response.status}): ${data.error?.message}. Usando neutrales para ${matchupName}.`);
                    return validateGeminiResponse("{}", teamA, teamB);
                }
            }

            const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
            const finishReason = data.candidates?.[0]?.finishReason;

            // MALFORMED_FUNCTION_CALL ocurre cuando Grounding y JSON mode coexisten.
            // Desactivar Grounding y reintentar con la misma key.
            if (!text && finishReason === 'MALFORMED_FUNCTION_CALL' && useGrounding) {
                console.warn(`[Gemini Engine] MALFORMED_FUNCTION_CALL con Grounding en key ${keyObj.display}. Reintentando sin Grounding...`);
                useGrounding = false;
                attempts++;
                continue;
            }

            if (!text) {
                console.warn(`[Gemini Engine] Respuesta vacía de Gemini para ${matchupName} (razón: ${finishReason}). Usando neutrales.`);
                return validateGeminiResponse("{}", teamA, teamB);
            }

            const finalFactors = validateGeminiResponse(text, teamA, teamB);
            
            // Extraer fuentes de Grounding
            const groundingChunks = data.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
            const sources = groundingChunks
                .map(chunk => chunk.web?.uri)
                .filter(Boolean);
            
            finalFactors.sources = sources;
            
            // Guardar en caché asíncronamente
            PersistentGeminiCache.setCachedAnalysis(strictCacheKey, finalFactors, 24).catch(e => console.error(e));
            
            return finalFactors;

        } catch (error) {
            console.warn(`[Gemini Engine] Error crítico llamando a Gemini para ${matchupName} con clave ${keyObj.display}: ${error.message}.`);
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
