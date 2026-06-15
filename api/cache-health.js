const PersistentGeminiCache = require('./lib/persistentCache');

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const stats = await PersistentGeminiCache.getCacheStats();
        
        let hitRate = 0;
        const total = (stats.hits || 0) + (stats.misses || 0);
        if (total > 0) hitRate = Math.round((stats.hits / total) * 100);

        return res.status(200).json({ 
            success: true, 
            provider: stats.provider,
            stats,
            hitRate: `${hitRate}%`
        });
    } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
};
