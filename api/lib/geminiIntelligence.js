const GEMINI_MODEL = 'gemini-2.5-flash';

// Simple memory cache para minimizar llamadas repetidas durante una sesión (Vercel Free)
const intelligenceCache = {};

function buildQuantitativePrompt(teamName) {
    return `Eres un Analista Profesional Cuantitativo de selecciones nacionales de fútbol.
No eres un narrador deportivo. Tu objetivo es proveer señales estructuradas para un motor matemático.

Analiza el estado actual de la selección de: ${teamName}.
Considera:
- Lesiones recientes de jugadores clave
- Sanciones o suspensiones
- Cambios recientes de entrenador
- Convocatorias y ausencias importantes
- Conflictos internos
- Estado anímico y presión mediática
- Rendimiento reciente y contexto competitivo

Reglas estrictas:
1. Responde ÚNICAMENTE con un objeto JSON válido.
2. No agregues texto fuera del JSON (ni saludos, ni markdown de \`\`\`json).
3. Evalúa cada impacto del -10 (muy negativo) al +10 (muy positivo). 0 es neutral.
4. "confidence" debe ser un entero entre 0 y 100 indicando qué tan seguro estás de la información actual de este equipo.

Formato requerido:
{
  "injuryImpact": 0,
  "suspensionImpact": 0,
  "coachImpact": 0,
  "tacticalImpact": 0,
  "motivationImpact": 0,
  "chemistryImpact": 0,
  "confidence": 0,
  "reasoning": "Breve explicación analítica en una sola línea."
}`;
}

async function fetchQuantitativeFactors(teamName, apiKey) {
    if (!apiKey) throw new Error('GEMINI_API_KEY no configurada');

    // Revisar caché
    if (intelligenceCache[teamName]) {
        return intelligenceCache[teamName];
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
    const prompt = buildQuantitativePrompt(teamName);

    const body = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
            temperature: 0.2, // Baja temperatura para respuestas consistentes y matemáticas
            topK: 40,
            topP: 0.95,
            response_mime_type: "application/json" // Fuerza salida JSON si la API lo soporta
        }
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(`Gemini API Error: ${data.error?.message}`);
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Respuesta vacía de Gemini');

    try {
        // Limpiamos posible markdown residual 
        const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const factors = JSON.parse(cleanText);
        
        // Guardamos en caché
        intelligenceCache[teamName] = factors;
        return factors;
    } catch (e) {
        throw new Error(`Error parseando JSON de Gemini: ${text}`);
    }
}

module.exports = {
    fetchQuantitativeFactors,
    intelligenceCache
};
