const PersistentGeminiCache = require('./lib/persistentCache');

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { 
            status: 405, 
            headers: { 'Content-Type': 'application/json' } 
        });
    }

    try {
        const stats = await PersistentGeminiCache.getCacheStats();
        
        const totalReqs = stats.hits + stats.misses;
        const hitRate = totalReqs > 0 ? ((stats.hits / totalReqs) * 100).toFixed(2) + '%' : '0%';

        return new Response(JSON.stringify({
            success: true,
            provider: stats.provider,
            hitRate: hitRate,
            totalRequests: totalReqs,
            stats: {
                hits: stats.hits,
                misses: stats.misses
            },
            memoryFallbackStats: {
                hits: stats.memoryHits,
                misses: stats.memoryMisses
            },
            timestamp: new Date().toISOString()
        }), {
            status: 200,
            headers: { 
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store'
            }
        });
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { 
            status: 500, 
            headers: { 'Content-Type': 'application/json' } 
        });
    }
}
