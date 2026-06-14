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

    try {
        const body = await req.json();
        const { teamA, teamB } = body;

        if (!teamA || !teamB) {
            return new Response(JSON.stringify({ error: 'Faltan parámetros teamA y/o teamB.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        const factors = await fetchQuantitativeFactors(teamA, teamB);

        return new Response(JSON.stringify({
            success: true,
            teamA,
            teamB,
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
