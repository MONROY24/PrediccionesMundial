/**
 * Betting Analyzer Layer
 *
 * Módulo desacoplado para evaluar rentabilidad de apuestas basado en las
 * predicciones del motor principal. No modifica ni interactúa directamente
 * con el estado de `engine.js`.
 */

class BettingAnalyzer {

    /**
     * Calcula la probabilidad implícita según la cuota de la casa de apuestas.
     * @param {number} odds Cuota decimal (ej. 1.80)
     * @returns {number} Probabilidad en formato decimal (ej. 0.555)
     */
    calculateImpliedProbability(odds) {
        if (!odds || odds <= 1) return 0;
        return 1 / odds;
    }

    /**
     * Calcula el Expected Value (EV).
     * Un EV positivo indica rentabilidad a largo plazo.
     * EV = (Probabilidad Real * Cuota) - 1
     * @param {number} modelProb Probabilidad calculada por nuestro motor (0 a 1)
     * @param {number} odds Cuota decimal
     * @returns {number} Valor esperado decimal
     */
    calculateEV(modelProb, odds) {
        if (!modelProb || !odds) return 0;
        return (modelProb * odds) - 1;
    }

    /**
     * Calcula la ventaja del apostador (Edge) porcentual frente a la casa.
     * Edge = (Probabilidad Real / Probabilidad Implícita) - 1
     * @param {number} modelProb Probabilidad calculada por nuestro motor (0 a 1)
     * @param {number} impliedProb Probabilidad implícita de la casa
     * @returns {number} Porcentaje de ventaja (ej. 5.5 = 5.5%)
     */
    calculateEdge(modelProb, impliedProb) {
        if (!impliedProb || impliedProb === 0) return 0;
        return ((modelProb / impliedProb) - 1) * 100;
    }

    /**
     * Evalúa una cuota específica.
     * @param {string} selection Nombre o tipo de selección (ej. 'Win A')
     * @param {number} modelProb Probabilidad real
     * @param {number} odds Cuota ofrecida
     * @returns {Object} Datos analíticos completos de esa selección
     */
    evaluateSelection(selection, modelProb, odds) {
        const impliedProb = this.calculateImpliedProbability(odds);
        const ev = this.calculateEV(modelProb, odds);
        const edge = this.calculateEdge(modelProb, impliedProb);
        
        return {
            selection,
            modelProb: parseFloat(modelProb.toFixed(4)),
            bookmakerOdds: odds,
            impliedProb: parseFloat(impliedProb.toFixed(4)),
            expectedValue: parseFloat(ev.toFixed(4)),
            edgePercent: parseFloat(edge.toFixed(2)),
            isValueBet: ev > 0 && edge > 0
        };
    }

    /**
     * Analiza los mercados populares de un partido completo.
     * @param {string} matchName Nombre del enfrentamiento (ej. 'Argentina vs México')
     * @param {Object} modelProbs Probabilidades { winA, draw, winB, ... }
     * @param {Object} bookmakerOdds Cuotas { winA, draw, winB, ... }
     * @returns {Array} Lista de análisis por cada selección
     */
    analyzeMatchMarkets(matchName, modelProbs, bookmakerOdds) {
        const results = [];

        // Evaluamos el mercado 1X2 si existe
        if (modelProbs.winA && bookmakerOdds.winA) {
            results.push({ match: matchName, ...this.evaluateSelection('Win A', modelProbs.winA, bookmakerOdds.winA) });
        }
        if (modelProbs.draw && bookmakerOdds.draw) {
            results.push({ match: matchName, ...this.evaluateSelection('Draw', modelProbs.draw, bookmakerOdds.draw) });
        }
        if (modelProbs.winB && bookmakerOdds.winB) {
            results.push({ match: matchName, ...this.evaluateSelection('Win B', modelProbs.winB, bookmakerOdds.winB) });
        }

        return results;
    }

    /**
     * Genera un ranking ordenado de oportunidades de apuestas.
     * @param {Array} analyzedMatches Arreglo de selecciones previamente evaluadas
     * @param {string} sortBy 'EV' o 'EDGE' (default: 'EV')
     * @param {boolean} onlyValueBets Si es true, filtra solo las apuestas rentables
     * @returns {Array} Lista ordenada de mejores a peores opciones
     */
    generateBettingRanking(analyzedMatches, sortBy = 'EV', onlyValueBets = true) {
        let list = analyzedMatches;

        if (onlyValueBets) {
            list = list.filter(bet => bet.isValueBet);
        }

        return list.sort((a, b) => {
            if (sortBy === 'EDGE') {
                return b.edgePercent - a.edgePercent;
            }
            // Sort by EV by default
            return b.expectedValue - a.expectedValue;
        });
    }

}

module.exports = new BettingAnalyzer();
