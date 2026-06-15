const geminiKeyManager = require('./_lib/GeminiKeyManager');

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const keyObj = geminiKeyManager.getCurrentKey();
    if (!keyObj || !keyObj.value) {
        return res.status(503).json({ error: 'API Key no configurada o todas las keys en cooldown' });
    }

    return res.status(200).json({ key: keyObj.value });
};
