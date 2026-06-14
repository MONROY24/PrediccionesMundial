// geminiWeights.js
// Motor de Ponderación para Análisis de Gemini

const GEMINI_WEIGHTS = {
    injury: 0.35,
    suspension: 0.20,
    coach: 0.15,
    tactical: 0.15,
    motivation: 0.10,
    chemistry: 0.05
};

class GeminiWeightEngine {
    constructor(customWeights = null) {
        this.weights = customWeights || GEMINI_WEIGHTS;
        
        // Validación: asegurar que los pesos sumen ~1.0
        let sum = 0;
        for (const w of Object.values(this.weights)) sum += w;
        if (Math.abs(sum - 1.0) > 0.01) {
            console.warn('[GeminiWeightEngine] Advertencia: los pesos no suman 1.0. Suma actual:', sum);
        }
    }

    /**
     * Calcula el impacto final en base a las puntuaciones [-10 a 10].
     * @param {Object} teamFactors Objeto con las puntuaciones devueltas por Gemini.
     * @returns {Object} Objeto con el impacto total y el desglose para auditoría.
     */
    calculateWeightedGeminiImpact(teamFactors) {
        if (!teamFactors) return { totalImpact: 0, breakdown: {} };

        let totalImpact = 0;
        const breakdown = {};

        for (const [factor, weight] of Object.entries(this.weights)) {
            // Si la IA omitió este factor o es inválido, asumimos 0 (neutral)
            const score = typeof teamFactors[factor] === 'number' ? teamFactors[factor] : 0;
            const weightedScore = score * weight;
            
            totalImpact += weightedScore;
            breakdown[factor] = {
                rawScore: score,
                weight: weight,
                weightedScore: parseFloat(weightedScore.toFixed(3))
            };
        }

        return {
            totalImpact: parseFloat(totalImpact.toFixed(3)),
            breakdown
        };
    }
}

// Exportación universal (Navegador y Node.js)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { GeminiWeightEngine, GEMINI_WEIGHTS };
} else {
    window.GeminiWeightEngine = GeminiWeightEngine;
    window.GEMINI_WEIGHTS = GEMINI_WEIGHTS;
}
