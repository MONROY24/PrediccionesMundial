const PersistentGeminiCache = require('./lib/persistentCache');
const GeminiDiagnosticsEngine = require('./lib/GeminiDiagnosticsEngine');
const geminiKeyManager = require('./lib/GeminiKeyManager');

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const type = req.query.type;

    try {
        if (type === 'cache') {
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
        } 
        
        else if (type === 'pool') {
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
        }
        
        else if (type === 'gemini') {
            const metrics = await GeminiDiagnosticsEngine.getAggregatedMetrics();
            return res.status(200).json({ success: true, modelsUsage: metrics.usageByModel });
        }
        
        else if (type === 'diagnostics') {
            const diagnostics = await GeminiDiagnosticsEngine.getDiagnostics();
            return res.status(200).json({ success: true, logs: diagnostics });
        }
        
        else if (type === 'system') {
            const metrics = await GeminiDiagnosticsEngine.getAggregatedMetrics();
            return res.status(200).json({ success: true, health: metrics });
        }
        
        else {
            return res.status(400).json({ success: false, error: 'Parámetro "type" inválido o faltante. Valores permitidos: cache, pool, gemini, diagnostics, system' });
        }

    } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
};
