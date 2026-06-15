const geminiKeyManager = require('./_lib/GeminiKeyManager');

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const keys = geminiKeyManager.keys.map(k => k.value).filter(Boolean);
    if (keys.length === 0) {
        return res.status(503).json({ error: 'API Keys no configuradas' });
    }

    return res.status(200).json({ keys });
};
