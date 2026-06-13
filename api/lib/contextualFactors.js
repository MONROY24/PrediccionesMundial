// ============================================================
// API/LIB/CONTEXTUAL-FACTORS.JS — Variables Avanzadas
//
// Calcula multiplicadores de ajuste para lambdas del motor.
// Impacto ACOTADO: nunca supera ±15% combinado.
//
// Variables implementadas:
//   1. Lesiones (injury)       → acotado ±8% por equipo
//   2. Sanciones (suspension)  → acotado ±5%
//   3. Altitud (altitude)      → acotado ±6% visitante
//   4. Fatiga (fatigue)        → acotado ±5%
//   5. Fixture congestion      → acotado ±4%
//   6. Clima (weather)         → acotado ±4%
//
// Referencia: Koopman & Lit (2015) - A bivariate Poisson model
// con covariables contextuales. Pesos calibrados para no dominar
// el núcleo Poisson-Dixon-Coles.
// ============================================================

/**
 * Calcula el multiplicador contextual para un equipo.
 *
 * @param {Object} factors - Variables contextuales para el equipo
 * @param {boolean} isHome - Si el equipo juega de local
 * @returns {number} Multiplicador en rango [0.85, 1.15]
 */
function computeTeamMultiplier(factors = {}, isHome = false) {
    let adjustment = 1.0;

    // ── 1. Lesiones de jugadores clave ──
    // injuredStars: 0 (ninguna) a 3 (estrellas clave ausentes)
    const injuredStars = Math.min(3, Math.max(0, factors.injuredStars || 0));
    if (injuredStars > 0) {
        // Función cóncava: 1 estrella → -3%, 2 → -6%, 3 → -8%
        const injuryImpact = -0.03 * Math.log(injuredStars + 1) / Math.log(2);
        adjustment *= (1 + Math.max(-0.08, injuryImpact));
    }

    // ── 2. Sanciones (jugadores suspendidos) ──
    // suspendedKey: 0 (ninguna) a 2 (jugadores importantes)
    const suspended = Math.min(2, Math.max(0, factors.suspendedKey || 0));
    if (suspended > 0) {
        const suspensionImpact = -0.025 * suspended;
        adjustment *= (1 + Math.max(-0.05, suspensionImpact));
    }

    // ── 3. Altitud (solo afecta al visitante) ──
    // altitudeEffect: boolean, true si la sede está a >2000m y el equipo es visitante
    if (!isHome && factors.altitudeEffect) {
        // Estudios muestran ~6% desventaja para visitantes en alta altitud
        adjustment *= 0.94;
    }

    // ── 4. Fatiga (días de descanso) ──
    // restDays: días desde el último partido
    const restDays = factors.restDays != null ? factors.restDays : 7;
    if (restDays < 4) {
        // <4 días: fatiga significativa (-5%)
        adjustment *= 0.95;
    } else if (restDays < 6) {
        // 4-5 días: fatiga leve (-2%)
        adjustment *= 0.98;
    }
    // ≥6 días: sin ajuste (normal)

    // ── 5. Fixture Congestion (partidos en los últimos 10 días) ──
    // recentMatches: número de partidos jugados en los últimos 10 días
    const recentMatches = Math.min(5, Math.max(0, factors.recentMatches || 1));
    if (recentMatches >= 4) {
        adjustment *= 0.96; // Congestion severa: -4%
    } else if (recentMatches >= 3) {
        adjustment *= 0.98; // Congestion moderada: -2%
    }

    // ── 6. Clima (calor extremo, lluvia intensa) ──
    // weatherPenalty: 0 (normal) a 1 (calor extremo/lluvia intensa)
    const weatherPenalty = Math.min(1, Math.max(0, factors.weatherPenalty || 0));
    if (weatherPenalty > 0.5) {
        adjustment *= 0.96; // Clima adverso: -4%
    } else if (weatherPenalty > 0.25) {
        adjustment *= 0.98; // Clima moderado: -2%
    }

    // ── Capping final: nunca más de ±15% sobre base ──
    return Math.max(0.85, Math.min(1.15, adjustment));
}

/**
 * Aplica factores contextuales a los lambdas ya calculados por el motor.
 *
 * IMPORTANTE: Esta función es POST-PROCESO sobre predictMatch().
 * El motor base (Poisson-Dixon-Coles) calcula sin ajustes contextuales.
 * Estos ajustes son informativos y están ACOTADOS para no distorsionar
 * el modelo matemático principal.
 *
 * @param {number} lambdaA - Lambda calculado por engine para equipo A
 * @param {number} lambdaB - Lambda calculado por engine para equipo B
 * @param {Object} factorsA - Factores contextuales equipo A
 * @param {Object} factorsB - Factores contextuales equipo B
 * @param {boolean} teamAIsHome - Si equipo A es local
 * @returns {{ lambdaA: number, lambdaB: number, adjustmentA: number, adjustmentB: number }}
 */
function applyContextualFactors(lambdaA, lambdaB, factorsA = {}, factorsB = {}, teamAIsHome = true) {
    const multA = computeTeamMultiplier(factorsA, teamAIsHome);
    const multB = computeTeamMultiplier(factorsB, !teamAIsHome);

    return {
        lambdaA:     parseFloat((lambdaA * multA).toFixed(3)),
        lambdaB:     parseFloat((lambdaB * multB).toFixed(3)),
        adjustmentA: multA,
        adjustmentB: multB,
        details: {
            teamAImpact: ((multA - 1) * 100).toFixed(1) + '%',
            teamBImpact: ((multB - 1) * 100).toFixed(1) + '%',
            note: 'Ajuste acotado a ±15% sobre lambda base (Poisson-Dixon-Coles)'
        }
    };
}

/**
 * Genera descripción legible de los factores contextuales.
 * Útil para enviar a Gemini como contexto adicional.
 */
function describeFactors(teamName, factors = {}) {
    const items = [];

    if (factors.injuredStars > 0) {
        items.push(`${factors.injuredStars} jugador(es) clave lesionado(s)`);
    }
    if (factors.suspendedKey > 0) {
        items.push(`${factors.suspendedKey} jugador(es) suspendido(s)`);
    }
    if (factors.altitudeEffect) {
        items.push('Juega como visitante en alta altitud (>2000m)');
    }
    if (factors.restDays != null && factors.restDays < 6) {
        items.push(`Solo ${factors.restDays} días de descanso desde el último partido`);
    }
    if (factors.recentMatches >= 3) {
        items.push(`Alta densidad de partidos (${factors.recentMatches} en 10 días)`);
    }
    if (factors.weatherPenalty > 0.5) {
        items.push('Condiciones climáticas adversas');
    }

    return items.length > 0
        ? `${teamName}: ${items.join(', ')}`
        : null;
}

module.exports = { applyContextualFactors, computeTeamMultiplier, describeFactors };
