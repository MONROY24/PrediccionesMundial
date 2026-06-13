// ============================================================
// RESULTS.JS — Módulo de Resultados Reales + Aprendizaje Incremental
// ============================================================
// Arquitectura: 100% localStorage (compatible con Vercel estático)
// Responsabilidades:
//   1. CRUD de resultados reales de partidos
//   2. Registro de predicciones para evaluación posterior
//   3. Recalibración del motor vía engine.updateFromResult()
//   4. Exportación/importación JSON
//   5. Cálculo y exposición de métricas al app.js
// ============================================================

class ResultsManager {
    constructor() {
        this.STORAGE_KEY_RESULTS    = 'wc2026_results';
        this.STORAGE_KEY_PREDS      = 'wc2026_predictions';
        this.STORAGE_KEY_CALIBRATION = 'wc2026_calibration';

        // Cache en memoria
        this._results    = this._load(this.STORAGE_KEY_RESULTS)    || [];
        this._predictions = this._load(this.STORAGE_KEY_PREDS)     || [];
        this._calibration = this._load(this.STORAGE_KEY_CALIBRATION) || null;
    }

    // ============================================================
    // Utilidades de Persistencia
    // ============================================================
    _load(key) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            console.warn(`[ResultsManager] Error cargando ${key}:`, e);
            return null;
        }
    }

    _save(key, data) {
        try {
            localStorage.setItem(key, JSON.stringify(data));
        } catch (e) {
            console.error(`[ResultsManager] Error guardando ${key}:`, e);
        }
    }

    // ============================================================
    // Sincronizar calibración del engine con localStorage
    // ============================================================
    saveEngineCalibration(engine) {
        const cal = {
            ...engine._calibration,
            eloSnapshot: Object.fromEntries(
                Object.entries(engine.teams).map(([name, t]) => [name, t.eloRating])
            ),
            savedAt: new Date().toISOString()
        };
        this._calibration = cal;
        this._save(this.STORAGE_KEY_CALIBRATION, cal);
    }

    restoreEngineCalibration(engine) {
        if (!this._calibration) return false;
        try {
            // Restaurar parámetros de calibración
            engine._calibration = {
                eloLearningRate: this._calibration.eloLearningRate  || 20,
                lambdaAdjustment: this._calibration.lambdaAdjustment || 1.0,
                rhoDynamic: this._calibration.rhoDynamic             || -0.08,
                matchesProcessed: this._calibration.matchesProcessed || 0,
                biasCorrection: this._calibration.biasCorrection     || 0.0
            };
            // Restaurar ELO histórico de cada equipo
            if (this._calibration.eloSnapshot) {
                Object.entries(this._calibration.eloSnapshot).forEach(([name, elo]) => {
                    if (engine.teams[name]) {
                        engine.teams[name].eloRating = elo;
                    }
                });
            }
            engine._strengthCache = {};
            return true;
        } catch (e) {
            console.error('[ResultsManager] Error restaurando calibración:', e);
            return false;
        }
    }

    // ============================================================
    // Guardar Predicción (antes del partido, para evaluación posterior)
    // ============================================================
    savePrediction(teamA, teamB, predictionResult) {
        const record = {
            id: `pred_${Date.now()}`,
            teamA,
            teamB,
            timestamp: new Date().toISOString(),
            prediction: {
                winA:           predictionResult.winA,
                draw:           predictionResult.draw,
                winB:           predictionResult.winB,
                mostLikelyScore: predictionResult.mostLikelyScore,
                lambdaA:        predictionResult.lambdaA,
                lambdaB:        predictionResult.lambdaB,
                modelType:      predictionResult._model?.modelType || 'standard',
                version:        predictionResult._model?.version   || '5.0'
            }
        };
        this._predictions.push(record);
        this._save(this.STORAGE_KEY_PREDS, this._predictions);
        return record.id;
    }

    // ============================================================
    // CRUD — Resultados Reales
    // ============================================================
    /**
     * Agrega un resultado real y recalibra el motor
     * @param {Object} params - { teamA, teamB, goalsA, goalsB, date, competition, stage }
     * @param {PredictionEngine} engine - instancia del motor para recalibración
     * @returns {Object} resultado guardado + métricas de actualización ELO
     */
    addResult(params, engine) {
        const { teamA, teamB, goalsA, goalsB, date, competition, stage } = params;

        if (!teamA || !teamB || goalsA == null || goalsB == null) {
            return { error: 'Faltan datos requeridos: teamA, teamB, goalsA, goalsB' };
        }
        if (!Number.isInteger(goalsA) || !Number.isInteger(goalsB) || goalsA < 0 || goalsB < 0) {
            return { error: 'Los goles deben ser números enteros no negativos' };
        }

        // Buscar predicción previa para este partido
        const matchedPred = this._predictions.find(p =>
            p.teamA === teamA && p.teamB === teamB && !p.resolved
        );

        // Recalibrar el motor con el resultado real
        let updateInfo = null;
        if (engine) {
            updateInfo = engine.updateFromResult(teamA, teamB, goalsA, goalsB,
                matchedPred?.prediction || null);

            // Persistir calibración actualizada
            this.saveEngineCalibration(engine);
        }

        // Marcar predicción como resuelta
        if (matchedPred) {
            matchedPred.resolved = true;
            matchedPred.actual = { goalsA, goalsB };
            this._save(this.STORAGE_KEY_PREDS, this._predictions);
        }

        // Guardar resultado
        const result = {
            id: `res_${Date.now()}`,
            teamA, teamB,
            goalsA: parseInt(goalsA),
            goalsB: parseInt(goalsB),
            date:   date || new Date().toISOString().split('T')[0],
            competition: competition || 'FIFA World Cup 2026',
            stage:  stage || 'Fase de Grupos',
            addedAt: new Date().toISOString(),
            predictionId: matchedPred?.id || null,
            updateInfo
        };

        this._results.push(result);
        this._save(this.STORAGE_KEY_RESULTS, this._results);

        return { success: true, result, updateInfo };
    }

    deleteResult(id, engine) {
        const idx = this._results.findIndex(r => r.id === id);
        if (idx === -1) return { error: 'Resultado no encontrado' };

        const deleted = this._results.splice(idx, 1)[0];
        this._save(this.STORAGE_KEY_RESULTS, this._results);

        // Nota: No revertimos el ELO ya que es complejo y puede introducir inconsistencias.
        // El usuario puede reconstruir desde cero si es necesario.
        return { success: true, deleted };
    }

    getResults() {
        return [...this._results].sort((a, b) => new Date(b.date) - new Date(a.date));
    }

    getResultCount() { return this._results.length; }

    // ============================================================
    // Métricas de Evaluación
    // ============================================================
    /**
     * Construye el dataset de evaluación cruzando predicciones con resultados reales
     */
    buildEvaluationDataset() {
        const dataset = [];

        this._results.forEach(result => {
            // Buscar predicción correspondiente
            const pred = this._predictions.find(p =>
                p.teamA === result.teamA &&
                p.teamB === result.teamB &&
                p.resolved &&
                p.actual?.goalsA === result.goalsA &&
                p.actual?.goalsB === result.goalsB
            );

            if (pred) {
                dataset.push({
                    prediction: pred.prediction,
                    actual: { goalsA: result.goalsA, goalsB: result.goalsB },
                    date: result.date,
                    teams: { a: result.teamA, b: result.teamB }
                });
            }
        });

        return dataset;
    }

    /**
     * Calcula métricas rápidas sin necesitar el engine completo
     * (Para cuando se carga el módulo de desempeño)
     */
    getQuickMetrics() {
        const results = this._results;
        if (results.length === 0) return null;

        const dataset = this.buildEvaluationDataset();
        const n = dataset.length;

        if (n === 0) {
            // Sin predicciones guardadas, solo métricas básicas de resultados
            const totalGoals = results.reduce((s, r) => s + r.goalsA + r.goalsB, 0);
            const draws = results.filter(r => r.goalsA === r.goalsB).length;
            const teamAWins = results.filter(r => r.goalsA > r.goalsB).length;
            const teamBWins = results.filter(r => r.goalsB > r.goalsA).length;

            return {
                hasMetrics: false,
                totalMatches: results.length,
                avgGoalsPerMatch: (totalGoals / results.length).toFixed(2),
                drawRate: (draws / results.length * 100).toFixed(1),
                teamAWinRate: (teamAWins / results.length * 100).toFixed(1),
                teamBWinRate: (teamBWins / results.length * 100).toFixed(1)
            };
        }

        // Métricas con predicciones
        let correctWinner = 0, correctExact = 0;
        let logLossSum = 0, brierSum = 0, maeSum = 0, rmseSum = 0;
        const EPS = 1e-10;

        // Historial de métricas por partido (para gráfica de tendencia)
        const history = [];
        let runningCorrect = 0;

        dataset.forEach(({ prediction: pred, actual }, idx) => {
            const gA = actual.goalsA, gB = actual.goalsB;
            const pA = pred.winA / 100, pD = pred.draw / 100, pB = pred.winB / 100;

            const predWinner = pA > pD && pA > pB ? 'A' : pB > pA && pB > pD ? 'B' : 'D';
            const actWinner  = gA > gB ? 'A' : gA === gB ? 'D' : 'B';

            if (predWinner === actWinner) { correctWinner++; runningCorrect++; }
            if (pred.mostLikelyScore === `${gA}-${gB}`) correctExact++;

            const pActual = gA > gB ? pA : gA === gB ? pD : pB;
            logLossSum += -Math.log(Math.max(pActual, EPS));

            const outA = gA > gB ? 1 : 0, outD = gA === gB ? 1 : 0, outB = gA < gB ? 1 : 0;
            brierSum += ((pA - outA)**2 + (pD - outD)**2 + (pB - outB)**2) / 3;

            const predGA = parseFloat(pred.lambdaA), predGB = parseFloat(pred.lambdaB);
            maeSum  += (Math.abs(predGA - gA) + Math.abs(predGB - gB)) / 2;
            rmseSum += ((predGA - gA)**2 + (predGB - gB)**2) / 2;

            history.push({
                idx: idx + 1,
                date: dataset[idx].date,
                teams: `${dataset[idx].teams.a} vs ${dataset[idx].teams.b}`,
                correct: predWinner === actWinner,
                exactScore: pred.mostLikelyScore === `${gA}-${gB}`,
                runningAccuracy: parseFloat((runningCorrect / (idx + 1) * 100).toFixed(1))
            });
        });

        return {
            hasMetrics: true,
            totalMatches: results.length,
            evaluatedMatches: n,
            accuracy: {
                winner:     parseFloat((correctWinner / n * 100).toFixed(1)),
                exactScore: parseFloat((correctExact  / n * 100).toFixed(1))
            },
            logLoss:    parseFloat((logLossSum / n).toFixed(4)),
            brierScore: parseFloat((brierSum   / n).toFixed(4)),
            maeGoals:   parseFloat((maeSum     / n).toFixed(3)),
            rmseGoals:  parseFloat((Math.sqrt(rmseSum / n)).toFixed(3)),
            history,
            calibrationInfo: this._calibration ? {
                matchesProcessed: this._calibration.matchesProcessed,
                biasCorrection:   (this._calibration.biasCorrection * 100).toFixed(2),
                rhoDynamic:       this._calibration.rhoDynamic?.toFixed(4),
                savedAt:          this._calibration.savedAt
            } : null
        };
    }

    // ============================================================
    // Exportación / Importación JSON
    // ============================================================
    exportJSON() {
        const data = {
            exportedAt: new Date().toISOString(),
            version: '5.0',
            results:     this._results,
            predictions: this._predictions,
            calibration: this._calibration
        };
        return JSON.stringify(data, null, 2);
    }

    importJSON(jsonString, engine) {
        try {
            const data = JSON.parse(jsonString);
            if (!data.results || !Array.isArray(data.results)) {
                return { error: 'Formato JSON inválido: se esperan "results" como array' };
            }

            this._results     = data.results;
            this._predictions = data.predictions || [];
            this._calibration = data.calibration || null;

            this._save(this.STORAGE_KEY_RESULTS,    this._results);
            this._save(this.STORAGE_KEY_PREDS,      this._predictions);
            this._save(this.STORAGE_KEY_CALIBRATION, this._calibration);

            // Restaurar calibración en el engine
            if (engine && this._calibration) {
                this.restoreEngineCalibration(engine);
            }

            return {
                success: true,
                imported: {
                    results: this._results.length,
                    predictions: this._predictions.length
                }
            };
        } catch (e) {
            return { error: `Error parseando JSON: ${e.message}` };
        }
    }

    clearAll(engine) {
        this._results = [];
        this._predictions = [];
        this._calibration = null;
        localStorage.removeItem(this.STORAGE_KEY_RESULTS);
        localStorage.removeItem(this.STORAGE_KEY_PREDS);
        localStorage.removeItem(this.STORAGE_KEY_CALIBRATION);

        // Restaurar engine a valores base
        if (engine) {
            engine._calibration = {
                eloLearningRate: 20,
                lambdaAdjustment: 1.0,
                rhoDynamic: -0.08,
                matchesProcessed: 0,
                biasCorrection: 0.0
            };
            engine._strengthCache = {};
        }

        return { success: true };
    }
}

// Instancia global (accesible desde app.js)
if (typeof window !== 'undefined') {
    window.ResultsManager = ResultsManager;
}

if (typeof module !== 'undefined' && module.exports) module.exports = ResultsManager;
