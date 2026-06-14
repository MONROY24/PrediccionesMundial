// config.js
// Configuración global para el motor predictivo

const CONFIG = {
    GEMINI_WEIGHTS: {
        injuryImpact: 0.35,
        suspensionImpact: 0.20,
        coachImpact: 0.15,
        tacticalImpact: 0.15,
        motivationImpact: 0.10,
        chemistryImpact: 0.05
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
} else if (typeof window !== 'undefined') {
    window.CONFIG = CONFIG;
} else if (typeof self !== 'undefined') {
    self.CONFIG = CONFIG;
}
