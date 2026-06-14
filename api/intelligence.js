const { fetchQuantitativeFactors } = require('./lib/geminiIntelligence');

// Node.js Serverless — compatible con ioredis, fs y PersistentGeminiCache
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
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { teamA, teamB } = body || {};

        if (!teamA || !teamB) {
            return res.status(400).json({ error: 'Faltan parámetros teamA y/o teamB.' });
        }

        const factors = await fetchQuantitativeFactors(teamA, teamB);

        return res.status(200).json({
            success: true,
            teamA,
            teamB,
            factors
        });

    } catch (error) {
        console.error('[intelligence] Error:', error.message);
        return res.status(500).json({
            error: `Error IA: ${error.message}`,
            code: 'GEMINI_ERROR'
        });
    }
};
