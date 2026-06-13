// ============================================================
// API/MODEL-STATE.JS — Estado Global del Modelo
// GET /api/model-state
//
// Devuelve los parámetros de calibración actuales del modelo
// compartido (rhoDynamic, biasCorrection, ELO snapshots, etc.)
// Los clientes usan esto para restaurar el estado del engine.
// ============================================================

let kv = null;
try {
    kv = require('@vercel/kv').kv;
} catch {
    // KV no disponible
}

const KV_CALIBRATION_KEY = 'wc2026:shared:calibration';
const KV_RESULTS_KEY     = 'wc2026:shared:results';

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Usa GET' });

    try {
        let calibration = null;
        let resultsCount = 0;

        if (kv) {
            try {
                calibration  = await kv.get(KV_CALIBRATION_KEY);
                const results = await kv.get(KV_RESULTS_KEY);
                resultsCount = Array.isArray(results) ? results.length : 0;
            } catch (e) {
                console.warn('[model-state] KV error:', e.message);
            }
        }

        // Estado por defecto si no hay calibración guardada
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
                sharedLearning: kv ? true : false,
                serverTime: new Date().toISOString()
            }
        });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};
