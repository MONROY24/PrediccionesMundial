// ============================================================
// API/RESULTS.JS — Backend Compartido de Resultados
// POST /api/results   → Guardar resultado + recalibrar modelo
// GET  /api/results   → Obtener todos los resultados compartidos
//
// Persistencia: Vercel KV (Redis) si está configurado,
//               fallback a respuesta en memoria si no.
//
// Todos los usuarios contribuyen al mismo modelo.
// ============================================================

// ── Intentar cargar Vercel KV (opcional) ──
let kv = null;
try {
    kv = require('@vercel/kv').kv;
    console.log('[results] Vercel KV disponible');
} catch {
    console.log('[results] Vercel KV no disponible, usando modo sin persistencia compartida');
}

const KV_RESULTS_KEY    = 'wc2026:shared:results';
const KV_CALIBRATION_KEY = 'wc2026:shared:calibration';
const KV_MAX_RESULTS    = 500;

// ── Fallback en memoria cuando no hay KV ──
let _memoryResults = [];
let _memoryCalibration = {
    matchesProcessed: 0,
    biasCorrection: 0.0,
    rhoDynamic: -0.08,
    eloSnapshot: {},
    lastUpdated: null
};

// ─────────────────────────────────────────────
// Acceso a almacenamiento (KV o memoria)
// ─────────────────────────────────────────────
async function getResults() {
    if (kv) {
        try {
            const data = await kv.get(KV_RESULTS_KEY);
            return data || [];
        } catch (e) {
            console.warn('[results] KV get error, usando memoria:', e.message);
        }
    }
    return _memoryResults;
}

async function saveResults(results) {
    if (kv) {
        try {
            // Limitar a los últimos MAX_RESULTS resultados
            const limited = results.slice(-KV_MAX_RESULTS);
            await kv.set(KV_RESULTS_KEY, limited);
            return;
        } catch (e) {
            console.warn('[results] KV set error, usando memoria:', e.message);
        }
    }
    _memoryResults = results.slice(-KV_MAX_RESULTS);
}

async function getCalibration() {
    if (kv) {
        try {
            const data = await kv.get(KV_CALIBRATION_KEY);
            return data || _memoryCalibration;
        } catch (e) {
            console.warn('[results] KV calibration get error:', e.message);
        }
    }
    return _memoryCalibration;
}

async function saveCalibration(calibration) {
    const calWithTime = { ...calibration, lastUpdated: new Date().toISOString() };
    if (kv) {
        try {
            await kv.set(KV_CALIBRATION_KEY, calWithTime);
            return;
        } catch (e) {
            console.warn('[results] KV calibration save error:', e.message);
        }
    }
    _memoryCalibration = calWithTime;
}

// ─────────────────────────────────────────────
// Actualización ELO (servidor replica la lógica de engine.js)
// Fórmula: ΔE = K × (S - E_esperada)
// K adaptativo: decrece con el número de partidos procesados
// ─────────────────────────────────────────────
function updateELO(calibration, teamA, teamB, goalsA, goalsB) {
    const cal = { ...calibration };
    const eloA = (cal.eloSnapshot?.[teamA]) || 1800;
    const eloB = (cal.eloSnapshot?.[teamB]) || 1800;

    // Probabilidad esperada (ELO estándar)
    const expectedA = 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
    const expectedB = 1 - expectedA;

    // Resultado real
    const actualA = goalsA > goalsB ? 1 : goalsA === goalsB ? 0.5 : 0;
    const actualB = 1 - actualA;

    // K-factor adaptativo
    const n = cal.matchesProcessed || 0;
    const K = Math.max(10, 20 / (1 + n * 0.05));

    // Nuevos ELO
    const newEloA = Math.round(eloA + K * (actualA - expectedA));
    const newEloB = Math.round(eloB + K * (actualB - expectedB));

    // Actualizar snapshot
    cal.eloSnapshot = { ...(cal.eloSnapshot || {}), [teamA]: newEloA, [teamB]: newEloB };

    // Ajustar RHO dinámico basado en empates observados
    if (goalsA === goalsB) {
        cal.rhoDynamic = Math.max(-0.20, (cal.rhoDynamic || -0.08) - 0.002);
    } else {
        cal.rhoDynamic = (cal.rhoDynamic || -0.08) + (-0.08 - (cal.rhoDynamic || -0.08)) * 0.05;
    }

    cal.matchesProcessed = n + 1;

    return {
        calibration: cal,
        eloChangeA: (newEloA - eloA).toFixed(1),
        eloChangeB: (newEloB - eloB).toFixed(1),
        newEloA,
        newEloB,
        K: K.toFixed(1)
    };
}

// ─────────────────────────────────────────────
// HANDLER PRINCIPAL
// ─────────────────────────────────────────────
module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') return res.status(200).end();

    // ── GET: Obtener resultados compartidos ──
    if (req.method === 'GET') {
        try {
            const results = await getResults();
            const calibration = await getCalibration();
            return res.status(200).json({
                success: true,
                results: results.slice(-100), // Últimos 100 al frontend
                calibration,
                totalCount: results.length,
                storageMode: kv ? 'vercel_kv' : 'memory'
            });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    // ── POST: Guardar resultado y recalibrar ──
    if (req.method === 'POST') {
        try {
            const { teamA, teamB, goalsA, goalsB, date, competition, stage, predictionWinA, predictionDraw, predictionWinB } = req.body || {};

            // Validar
            if (!teamA || !teamB || goalsA == null || goalsB == null) {
                return res.status(400).json({ error: 'Faltan: teamA, teamB, goalsA, goalsB' });
            }
            if (!Number.isInteger(goalsA) || !Number.isInteger(goalsB) || goalsA < 0 || goalsB < 0) {
                return res.status(400).json({ error: 'goalsA y goalsB deben ser enteros ≥ 0' });
            }

            const results = await getResults();
            const calibration = await getCalibration();

            // Actualizar ELO con el resultado real
            const eloUpdate = updateELO(calibration, teamA, teamB, goalsA, goalsB);

            // Guardar calibración actualizada
            await saveCalibration(eloUpdate.calibration);

            // Crear registro del resultado
            const result = {
                id: `srv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                teamA, teamB,
                goalsA: parseInt(goalsA),
                goalsB: parseInt(goalsB),
                date: date || new Date().toISOString().split('T')[0],
                competition: competition || 'FIFA World Cup 2026',
                stage: stage || 'Fase de Grupos',
                savedAt: new Date().toISOString(),
                prediction: predictionWinA != null ? { winA: predictionWinA, draw: predictionDraw, winB: predictionWinB } : null,
                eloUpdate: {
                    changeA: eloUpdate.eloChangeA,
                    changeB: eloUpdate.eloChangeB,
                    newEloA: eloUpdate.newEloA,
                    newEloB: eloUpdate.newEloB
                }
            };

            results.push(result);
            await saveResults(results);

            return res.status(200).json({
                success: true,
                result,
                eloUpdate: {
                    eloChangeA: eloUpdate.eloChangeA,
                    eloChangeB: eloUpdate.eloChangeB,
                    newEloA: eloUpdate.newEloA,
                    newEloB: eloUpdate.newEloB,
                    matchesProcessed: eloUpdate.calibration.matchesProcessed,
                    K: eloUpdate.K
                },
                calibration: eloUpdate.calibration,
                storageMode: kv ? 'vercel_kv' : 'memory'
            });

        } catch (error) {
            console.error('[results POST] Error:', error.message);
            return res.status(500).json({ error: error.message });
        }
    }

    return res.status(405).json({ error: 'Método no permitido' });
};
