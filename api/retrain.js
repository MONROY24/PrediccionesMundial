// ============================================================
// API/RETRAIN.JS — Recalibración Completa del Modelo
// POST /api/retrain
//
// Aplica grid search sobre los parámetros:
//   - BASE_LAMBDA ∈ [1.0, 1.8]  (paso 0.1)
//   - RHO        ∈ [-0.20, 0.0] (paso 0.02)
//   - LAMBDA_K   ∈ [1.2, 2.5]   (paso 0.2)
//
// Minimiza Log-Loss y Brier Score usando partidos históricos
// almacenados en KV + historical_matches.json
//
// JUSTIFICACIÓN MATEMÁTICA:
//   Log-Loss = -1/N × Σ log(p_resultado_real)
//   Brier    = 1/N × Σ [(pA-oA)² + (pD-oD)² + (pB-oB)²] / 3
//
//   Se busca el mínimo de 0.5×LogLoss + 0.5×Brier (normalizado)
// ============================================================

const path = require('path');
const fs   = require('fs');

let kv = null;
try {
    kv = require('@vercel/kv').kv;
} catch { }

const KV_RESULTS_KEY    = 'wc2026:shared:results';
const KV_PARAMS_KEY     = 'wc2026:shared:optimal_params';

// ─────────────────────────────────────────────
// Implementación mínima de Poisson-Dixon-Coles
// para grid search (sin depender de engine.js)
// ─────────────────────────────────────────────
function poissonPMF(k, lambda) {
    if (k < 0 || lambda <= 0) return 0;
    let logP = -lambda + k * Math.log(lambda);
    for (let i = 2; i <= k; i++) logP -= Math.log(i);
    const p = Math.exp(logP);
    return isNaN(p) || p < 0 ? 0 : p;
}

function dixonColes(x, y, lA, lB, rho) {
    const base = poissonPMF(x, lA) * poissonPMF(y, lB);
    if (base <= 0) return 0;
    let corr = 1.0;
    if      (x === 0 && y === 0) corr = 1 - lA * lB * rho;
    else if (x === 0 && y === 1) corr = 1 + lA * rho;
    else if (x === 1 && y === 0) corr = 1 + lB * rho;
    else if (x === 1 && y === 1) corr = 1 - rho;
    return Math.max(0, base * corr);
}

function predictWithParams(eloA, eloB, baseLambda, rho, lambdaK, maxGoals = 7) {
    const pWinA = 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
    const pWinB = 1 - pWinA;

    const lambdaA = Math.max(0.15, Math.min(maxGoals, baseLambda * Math.exp(lambdaK * (pWinA - 0.5))));
    const lambdaB = Math.max(0.15, Math.min(maxGoals, baseLambda * Math.exp(lambdaK * (pWinB - 0.5))));

    let winA = 0, draw = 0, winB = 0;
    let totalSum = 0;

    for (let i = 0; i <= maxGoals; i++) {
        for (let j = 0; j <= maxGoals; j++) {
            const p = dixonColes(i, j, lambdaA, lambdaB, rho);
            if (i > j) winA += p;
            else if (i < j) winB += p;
            else draw += p;
            totalSum += p;
        }
    }

    if (totalSum > 0) { winA /= totalSum; draw /= totalSum; winB /= totalSum; }

    return { winA, draw, winB, lambdaA, lambdaB };
}

function computeMetrics(records, baseLambda, rho, lambdaK) {
    const EPS = 1e-10;
    let logLossSum = 0, brierSum = 0, n = 0;

    records.forEach(({ eloA, eloB, goalsA, goalsB }) => {
        if (eloA == null || eloB == null || goalsA == null || goalsB == null) return;

        const pred = predictWithParams(eloA, eloB, baseLambda, rho, lambdaK);
        const { winA: pA, draw: pD, winB: pB } = pred;

        const outA = goalsA > goalsB ? 1 : 0;
        const outD = goalsA === goalsB ? 1 : 0;
        const outB = goalsA < goalsB ? 1 : 0;

        const pActual = outA ? pA : outD ? pD : pB;
        logLossSum += -Math.log(Math.max(pActual, EPS));
        brierSum   += ((pA - outA) ** 2 + (pD - outD) ** 2 + (pB - outB) ** 2) / 3;
        n++;
    });

    if (n === 0) return { logLoss: 999, brierScore: 999, n: 0 };
    return { logLoss: logLossSum / n, brierScore: brierSum / n, n };
}

// ─────────────────────────────────────────────
// Grid Search
// ─────────────────────────────────────────────
function gridSearch(records) {
    const baseLambdaRange = [1.0, 1.1, 1.2, 1.25, 1.3, 1.35, 1.4, 1.5, 1.6, 1.7, 1.8];
    const rhoRange        = [-0.20, -0.16, -0.12, -0.10, -0.08, -0.06, -0.04, -0.02, 0.0];
    const lambdaKRange    = [1.2, 1.4, 1.6, 1.8, 2.0, 2.2, 2.5];

    let bestScore = Infinity;
    let bestParams = { baseLambda: 1.35, rho: -0.08, lambdaK: 1.8 };
    let bestMetrics = null;

    for (const baseLambda of baseLambdaRange) {
        for (const rho of rhoRange) {
            for (const lambdaK of lambdaKRange) {
                const m = computeMetrics(records, baseLambda, rho, lambdaK);
                // Score combinado: 60% Log-Loss + 40% Brier (normalizado a [0,1])
                const score = 0.6 * m.logLoss + 0.4 * m.brierScore;
                if (score < bestScore) {
                    bestScore = score;
                    bestParams = { baseLambda, rho, lambdaK };
                    bestMetrics = m;
                }
            }
        }
    }

    return { bestParams, bestMetrics, bestScore };
}

// ─────────────────────────────────────────────
// HANDLER PRINCIPAL
// ─────────────────────────────────────────────
module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Usa POST' });

    try {
        // Cargar historical_matches.json
        const histPath = path.join(process.cwd(), 'api', 'lib', 'historical_matches.json');
        let historicalMatches = [];
        if (fs.existsSync(histPath)) {
            historicalMatches = JSON.parse(fs.readFileSync(histPath, 'utf8'));
        }

        // Cargar resultados compartidos de KV (si disponible)
        let sharedResults = [];
        if (kv) {
            try {
                sharedResults = (await kv.get(KV_RESULTS_KEY)) || [];
            } catch (e) {
                console.warn('[retrain] KV error:', e.message);
            }
        }

        // Combinar registros para el backtesting
        // Los resultados compartidos incluyen ELO implícito (usamos valores por defecto si no hay)
        const DEFAULT_ELO = 1800;
        const records = [
            // Partidos históricos WC 2022 (con ELO conocidos)
            ...historicalMatches.map(m => ({
                eloA: m.eloA || DEFAULT_ELO,
                eloB: m.eloB || DEFAULT_ELO,
                goalsA: m.goalsA,
                goalsB: m.goalsB
            })),
            // Resultados ingresados por usuarios (ELO aproximado)
            ...sharedResults.map(r => ({
                eloA: DEFAULT_ELO,
                eloB: DEFAULT_ELO,
                goalsA: r.goalsA,
                goalsB: r.goalsB
            }))
        ].filter(r => r.eloA != null && r.goalsA != null);

        if (records.length < 10) {
            return res.status(400).json({
                error: 'Datos insuficientes para backtesting (mínimo 10 partidos)',
                recordsAvailable: records.length
            });
        }

        // Ejecutar grid search
        const { bestParams, bestMetrics, bestScore } = gridSearch(records);

        // Calcular métricas de los parámetros actuales (base) para comparación
        const currentMetrics = computeMetrics(records, 1.35, -0.08, 1.8);

        // Guardar params óptimos en KV
        if (kv) {
            try {
                await kv.set(KV_PARAMS_KEY, {
                    ...bestParams,
                    calculatedAt: new Date().toISOString(),
                    recordsUsed: records.length,
                    metrics: bestMetrics
                });
            } catch (e) {
                console.warn('[retrain] KV save error:', e.message);
            }
        }

        return res.status(200).json({
            success: true,
            optimalParams: bestParams,
            metrics: {
                optimal: { ...bestMetrics, combinedScore: bestScore.toFixed(4) },
                baseline: { ...currentMetrics, combinedScore: (0.6 * currentMetrics.logLoss + 0.4 * currentMetrics.brierScore).toFixed(4) },
                improvement: {
                    logLoss:    (((currentMetrics.logLoss    - bestMetrics.logLoss)    / currentMetrics.logLoss    * 100).toFixed(1) + '%'),
                    brierScore: (((currentMetrics.brierScore - bestMetrics.brierScore) / currentMetrics.brierScore * 100).toFixed(1) + '%')
                }
            },
            recordsUsed: records.length,
            gridSearchCombinations: 11 * 9 * 7,
            methodology: 'Score = 0.6×LogLoss + 0.4×BrierScore — minimización conjunta',
            calculatedAt: new Date().toISOString()
        });

    } catch (error) {
        console.error('[retrain] Error:', error.message);
        return res.status(500).json({ error: error.message });
    }
};
