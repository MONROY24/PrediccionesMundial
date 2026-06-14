const geminiKeyManager = require('./lib/GeminiKeyManager');

export const config = {
    runtime: 'edge',
};

export default async function handler(req) {
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            status: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            }
        });
    }

    if (req.method !== 'GET') {
        return new Response(JSON.stringify({ error: 'Método no permitido. Usa GET.' }), { 
            status: 405, 
            headers: { 'Content-Type': 'application/json' } 
        });
    }

    try {
        const status = geminiKeyManager.getStatus();

        return new Response(JSON.stringify(status), {
            status: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            }
        });
    } catch (error) {
        console.error('[gemini-status edge] Error:', error.message);
        return new Response(JSON.stringify({
            error: `Error interno de Key Manager: ${error.message}`
        }), {
            status: 500,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            }
        });
    }
}
