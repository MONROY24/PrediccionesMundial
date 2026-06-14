const geminiKeyManager = require('./lib/GeminiKeyManager');

// Node.js Serverless — compatible con ioredis y fs
module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        return res.status(200).end();
    }
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Método no permitido. Usa GET.' });
    }
    try {
        const status = geminiKeyManager.getStatus();
        return res.status(200).json(status);
    } catch (error) {
        console.error('[gemini-status] Error:', error.message);
        return res.status(500).json({ error: `Error interno: ${error.message}` });
    }
};
