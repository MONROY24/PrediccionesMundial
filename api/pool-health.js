const geminiKeyManager = require('./lib/GeminiKeyManager');

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const keys = geminiKeyManager.keys.map(k => ({
            id: k.id,
            display: k.display,
            status: k.status,
            requests: k.requests,
            errors: k.errors,
            cooldownUntil: k.cooldownUntil
        }));
        
        return res.status(200).json({ 
            success: true, 
            totalKeys: geminiKeyManager.keys.length,
            availableKeys: geminiKeyManager.getAvailableKeys().length,
            pool: keys 
        });
    } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
};
