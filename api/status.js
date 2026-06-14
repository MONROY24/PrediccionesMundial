// ============================================================
// api/status.js — Router unificado de utilidades
// Consolida: /api/status?type=gemini | cache | key | model
// Reduce el conteo de Serverless Functions en Vercel Hobby.
// ============================================================

const geminiKeyManager = require('./lib/GeminiKeyManager');
const PersistentGeminiCache = require('./lib/persistentCache');

let kv = null;
try { kv = require('@vercel/kv').kv; } catch { /* KV no disponible */ }

const KV_CALIBRATION_KEY = 'wc2026:shared:calibration';
const KV_RESULTS_KEY     = 'wc2026:shared:results';

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET')    return res.status(405).json({ error: 'Usa GET' });

    const type = req.query?.type || 'gemini';

    // --- /api/status?type=gemini (equivalente a /api/gemini-status) ---
    if (type === 'gemini') {
        try {
            const status = geminiKeyManager.getStatus();
            return res.status(200).json(status);
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    }

    // --- /api/status?type=cache (equivalente a /api/cache-status) ---
    if (type === 'cache') {
        try {
            const stats = await PersistentGeminiCache.getCacheStats();
            const totalReqs = stats.hits + stats.misses;
            const hitRate = totalReqs > 0 ? ((stats.hits / totalReqs) * 100).toFixed(2) + '%' : '0%';
            return res.status(200).json({
                success: true,
                provider: stats.provider,
                hitRate,
                totalRequests: totalReqs,
                stats: { hits: stats.hits, misses: stats.misses },
                memoryFallbackStats: { hits: stats.memoryHits, misses: stats.memoryMisses },
                timestamp: new Date().toISOString()
            });
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    }

    // --- /api/status?type=key (equivalente a /api/get-key) ---
    if (type === 'key') {
        const key = process.env.GEMINI_API_KEY;
        if (!key) return res.status(503).json({ error: 'API Key no configurada' });
        return res.status(200).json({ key });
    }

    // --- /api/status?type=model (equivalente a /api/model-state) ---
    if (type === 'model') {
        try {
            let calibration = null;
            let resultsCount = 0;

            if (kv) {
                try {
                    calibration  = await kv.get(KV_CALIBRATION_KEY);
                    const results = await kv.get(KV_RESULTS_KEY);
                    resultsCount = Array.isArray(results) ? results.length : 0;
                } catch (e) {
                    console.warn('[status/model] KV error:', e.message);
                }
            }

            const defaultCalibration = {
                matchesProcessed: 0,
                biasCorrection: 0.0,
                rhoDynamic: -0.08,
                lambdaAdjustment: 1.0,
                eloLearningRate: 20,
                eloSnapshot: {},
                lastUpdated: null
            };

            const state = calibration || defaultCalibration;
            return res.status(200).json({
                success: true,
                calibration: state,
                meta: {
                    totalResultsStored: resultsCount,
                    storageMode: kv ? 'vercel_kv' : 'memory_only',
                    sharedLearning: !!kv,
                    serverTime: new Date().toISOString()
                }
            });
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    }

    return res.status(400).json({ error: 'type inválido. Usa: gemini | cache | key | model' });
};
