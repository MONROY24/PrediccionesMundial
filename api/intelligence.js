const { fetchQuantitativeFactors } = require('./lib/geminiIntelligence');

export const config = {
    runtime: 'edge',
};

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
            error: 'GEMINI_API_KEY no configurada.',
            code: 'MISSING_API_KEY'
        }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    }

    try {
        const body = await req.json();
        const { teamName } = body;

        if (!teamName) {
            return new Response(JSON.stringify({ error: 'Falta el parámetro teamName.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        const factors = await fetchQuantitativeFactors(teamName, GEMINI_API_KEY);

        return new Response(JSON.stringify({
            success: true,
            team: teamName,
            factors: factors
        }), {
            status: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            }
        });

    } catch (error) {
        console.error('[intelligence edge] Error:', error.message);
        return new Response(JSON.stringify({
            error: `Error IA: ${error.message}`,
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
