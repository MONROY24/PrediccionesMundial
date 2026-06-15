const GEMINI_MODELS = [
    'gemini-3.5-flash',       // MODEL_PRIMARY
    'gemini-2.5-flash',       // MODEL_FALLBACK
    'gemini-3.1-flash-lite'   // MODEL_EMERGENCY
];

const PersistentGeminiCache = require('./persistentCache');
const GeminiDiagnosticsEngine = require('./GeminiDiagnosticsEngine');

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

const { GeminiReliabilityEngine, GeminiStatus } = require('./GeminiReliabilityEngine');
const geminiKeyManager = require('./GeminiKeyManager');

async function fetchQuantitativeFactors(teamA, teamB) {
    const matchupName = `${teamA} vs ${teamB}`;
    
    const strictCacheKey = `quant_${teamA}_vs_${teamB}`;
    const cachedData = await PersistentGeminiCache.getCachedAnalysis(strictCacheKey);
    if (cachedData) {
        GeminiDiagnosticsEngine.recordDiagnostic({
            timestamp: new Date().toISOString(),
            match: matchupName,
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
        return cachedData;
    }

    const prompt = buildQuantitativePrompt(teamA, teamB);
    let useGrounding = true; // Intentar con Grounding primero
    let currentModelIndex = 0;

    const result = await GeminiReliabilityEngine.executeGeminiRequest(async (attempt, lastStatus) => {
        let keyObj = geminiKeyManager.getCurrentKey();
        if (!keyObj) return null; // No hay claves

        if (lastStatus === GeminiStatus.MODEL_NOT_FOUND || lastStatus === GeminiStatus.COMPATIBILITY_ERROR) {
            currentModelIndex++;
            if (currentModelIndex >= GEMINI_MODELS.length) {
                return null; // Ya probamos todos los modelos
            }
            console.warn(`[GeminiIntelligence] Fallo en modelo actual, cambiando a: ${GEMINI_MODELS[currentModelIndex]}`);
        } else if (lastStatus === GeminiStatus.MODEL_ERROR || lastStatus === GeminiStatus.TIMEOUT) {
            geminiKeyManager.recordError(keyObj, 'general');
        } else if (lastStatus === GeminiStatus.QUOTA_EXCEEDED || lastStatus === GeminiStatus.RATE_LIMIT) {
            if (useGrounding) {
                useGrounding = false; // Fallback 1: quitar grounding
            } else {
                geminiKeyManager.recordError(keyObj, 'quota');
                useGrounding = true;
                currentModelIndex = 0; // Intentar con la nueva key desde el primer modelo
                keyObj = geminiKeyManager.getCurrentKey();
                if (!keyObj) return null;
            }
        } else if (lastStatus === GeminiStatus.INVALID_RESPONSE && useGrounding) {
            useGrounding = false;
        }

        const model = GEMINI_MODELS[currentModelIndex];
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${keyObj.value}`;
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

        return { url, body, model, keyObj };
    }, { MAX_RETRIES: 2, REQUEST_TIMEOUT_MS: 10000 });

    if (result.status === GeminiStatus.SUCCESS && result.text) {
        if (result.keyObj) geminiKeyManager.recordSuccess(result.keyObj, result.latency);
        const finalFactors = validateGeminiResponse(result.text, teamA, teamB);
        finalFactors.sources = result.sources || [];
        finalFactors.latency = result.latency || 0;
        finalFactors.modelUsed = result.modelUsed;
        finalFactors.toolsUsed = result.toolsUsed || [];
        
        // Guardar en caché asíncronamente
        PersistentGeminiCache.setCachedAnalysis(strictCacheKey, finalFactors, 24).catch(e => console.error(e));
        
        GeminiDiagnosticsEngine.recordDiagnostic({
            timestamp: new Date().toISOString(),
            match: matchupName,
            model: result.modelUsed || GEMINI_MODELS[0],
            apiKeyIndex: geminiKeyManager.currentKeyIndex !== undefined ? geminiKeyManager.currentKeyIndex : -1,
            responseTime: result.latency || 0,
            cacheHit: false,
            cacheMiss: true,
            retryCount: 0,
            groundingUsed: (result.toolsUsed || []).includes('googleSearch'),
            groundingSuccess: (result.toolsUsed || []).includes('googleSearch'),
            status: 'SUCCESS'
        }).catch(e => console.error(e));

        return finalFactors;
    }

    console.warn(`[Gemini Engine] Fallo al obtener factores para ${matchupName} (Estado final: ${result.status}). Usando neutrales.`);
    
    GeminiDiagnosticsEngine.recordDiagnostic({
        timestamp: new Date().toISOString(),
        match: matchupName,
        model: result.modelUsed || GEMINI_MODELS[0],
        apiKeyIndex: geminiKeyManager.currentKeyIndex !== undefined ? geminiKeyManager.currentKeyIndex : -1,
        responseTime: result.latency || 0,
        cacheHit: false,
        cacheMiss: true,
        retryCount: 0,
        groundingUsed: (result.toolsUsed || []).includes('googleSearch'),
        groundingSuccess: false,
        status: result.status || 'ERROR'
    }).catch(e => console.error(e));

    return validateGeminiResponse("{}", teamA, teamB);
}

module.exports = {
    fetchQuantitativeFactors,
    sanitizeGeminiFactors,
    validateGeminiResponse
};
