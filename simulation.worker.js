// ============================================================
// SIMULATION WORKER (Web Worker para simulación Monte Carlo)
// ============================================================

importScripts('config.js', 'engine.js');

self.onmessage = function(e) {
    const { data, iterations, modelType } = e.data;
    
    // Instanciar el motor con los datos proveídos desde la UI y el modelo seleccionado
    const engine = new PredictionEngine(data, modelType);
    
    // Inicializar objeto de resultados
    const res = {};
    Object.keys(engine.teams).forEach(team => {
        res[team] = { 
            team, 
            flag: engine.teams[team].flag,
            groupStage: 0, 
            roundOf32: 0, 
            roundOf16: 0,
            quarterFinals: 0, 
            semiFinals: 0, 
            final: 0,
            champion: 0, 
            totalPoints: 0 
        };
    });

    // Procesar en lotes para permitir actualizaciones de progreso asíncronas
    const batchSize = Math.max(500, Math.floor(iterations / 20));
    let completed = 0;

    function runBatch() {
        const currentBatch = Math.min(batchSize, iterations - completed);
        
        for (let i = 0; i < currentBatch; i++) {
            engine._runSingleTournamentIteration(res);
        }
        
        completed += currentBatch;
        
        // Enviar progreso a la UI
        self.postMessage({ type: 'progress', completed, total: iterations });
        
        if (completed < iterations) {
            // Ceder control al event loop antes del próximo lote
            setTimeout(runBatch, 0);
        } else {
            // Calcular porcentajes finales
            const finalResults = Object.values(res).map(t => ({
                ...t,
                groupStage:    parseFloat((t.groupStage    / iterations * 100).toFixed(1)),
                roundOf32:     parseFloat((t.roundOf32     / iterations * 100).toFixed(1)),
                roundOf16:     parseFloat((t.roundOf16     / iterations * 100).toFixed(1)),
                quarterFinals: parseFloat((t.quarterFinals / iterations * 100).toFixed(1)),
                semiFinals:    parseFloat((t.semiFinals    / iterations * 100).toFixed(1)),
                final:         parseFloat((t.final         / iterations * 100).toFixed(1)),
                champion:      parseFloat((t.champion      / iterations * 100).toFixed(1)),
                avgPoints:     parseFloat((t.totalPoints   / iterations).toFixed(1))
            })).sort((a, b) => b.champion - a.champion);

            // Enviar resultados finales
            self.postMessage({ type: 'done', results: finalResults });
        }
    }

    // Iniciar simulación
    runBatch();
};
