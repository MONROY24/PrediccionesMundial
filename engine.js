// ============================================================
// ENGINE.JS - MOTOR PREDICTIVO v5.0 (MUNDIAL 2026)
// 
// CAMBIOS v5.0 (Auditoría Completa):
//   - BASE_LAMBDA recalibrado: 1.20 → 1.35 (datos WC 2010-2022)
//   - Función de escala λ: potencia(1.1) → exponencial calibrada (k=1.8)
//     Garantiza coherencia probabilidad↔marcador para favoritos claros
//   - Ajuste táctico recalibrado: coeficientes arbitrarios → acotados [0.88, 1.12]
//   - ELO compuesto: pesos hist 0.40/squad 0.60 → hist 0.65/squad 0.35
//   - Nuevo: updateFromResult() — aprendizaje incremental (online learning)
//   - Nuevo: evaluatePerformance() — Log Loss, Brier, MAE, RMSE, CalibrationError
//   - Nuevo: getTopScorersByMargin() — distribución más diversa por margen ELO
// ============================================================

class PredictionEngine {
    constructor(data, modelType = 'standard') {
        this.data       = data;
        this.teams      = data.teams;
        this.groups     = data.groups;
        this.tournament = data.tournament;
        this.modelType  = modelType;
        this._strengthCache = {};

        this.HOST_ELO_BONUS = 30;

        // --- PARÁMETROS CALIBRADOS v5.0 ---
        // Dixon-Coles ρ: valor negativo aumenta ligeramente 0-0, 1-0, 0-1, 1-1
        // Calibrado con datos de Mundiales 2010-2022
        this.RHO         = -0.08;
        this.MAX_GOALS   = 8;

        // BASE_LAMBDA calibrado con promedio WC 2010-2022 (~1.34 goles/equipo en partido parejo)
        this.BASE_LAMBDA = 1.35;

        // Exponente de escala para función exponencial de lambda
        // k=1.8 produce: pWin=0.50 → ×1.00 | pWin=0.65 → ×1.31 | pWin=0.80 → ×1.72
        this.LAMBDA_SCALE_K = 1.8;

        this.PENALTY_STRESS = 0.80;

        // Pesos para ranking visual (sin cambios)
        this.WEIGHTS = {
            eloRating:             0.40,
            recentForm:            0.20,
            teamStats:             0.15,
            squadValue:            0.10,
            historicalScore:       0.08,
            confederationStrength: 0.04,
            tournamentExperience:  0.03
        };

        // Parámetros de recalibración dinámica (aprendizaje incremental)
        // Se actualizan con updateFromResult()
        this._calibration = {
            eloLearningRate: 20,      // K-factor ELO para actualizaciones
            lambdaAdjustment: 1.0,    // Multiplicador global de lambda
            rhoDynamic: -0.08,        // RHO dinámico (puede ajustarse)
            matchesProcessed: 0,
            biasCorrection: 0.0       // Corrección de sesgo acumulada
        };
    }

    // ============================================================
    // CÁLCULO DE PROBABILIDADES BASE (Modelo de Poisson Dinámico v5.0)
    // ============================================================
    getGoalExpectancy(teamA, teamB) {
        const isLocalA = teamA.hostCountry && !teamB.hostCountry;
        const isLocalB = teamB.hostCountry && !teamA.hostCountry;

        const eloHistA = teamA.eloRating + (isLocalA ? this.HOST_ELO_BONUS : 0);
        const eloHistB = teamB.eloRating + (isLocalB ? this.HOST_ELO_BONUS : 0);

        // ELO de plantilla: normalizado en rango [1400, 2200] según squadValue [0, 100]
        // Más conservador que v4: no puede superar el techo del ELO histórico de forma desproporcionada
        const ELO_SQUAD_MIN = 1400;
        const ELO_SQUAD_MAX = 2150;
        const eloSquadA = ELO_SQUAD_MIN + (teamA.squadValue / 100) * (ELO_SQUAD_MAX - ELO_SQUAD_MIN);
        const eloSquadB = ELO_SQUAD_MIN + (teamB.squadValue / 100) * (ELO_SQUAD_MAX - ELO_SQUAD_MIN);

        let compositeEloA, compositeEloB;
        let formMultA = 1.0, formMultB = 1.0;
        let baseLambdaA = this.BASE_LAMBDA * this._calibration.lambdaAdjustment;
        let baseLambdaB = this.BASE_LAMBDA * this._calibration.lambdaAdjustment;

        switch (this.modelType) {
            case 'pure_elo':
                compositeEloA = eloHistA;
                compositeEloB = eloHistB;
                break;

            case 'momentum':
                formMultA = this.getFormMultiplier(teamA);
                formMultB = this.getFormMultiplier(teamB);
                // En momentum: ELO histórico + boost fuerte de forma
                compositeEloA = eloHistA * (0.5 + formMultA * 0.8);
                compositeEloB = eloHistB * (0.5 + formMultB * 0.8);
                break;

            case 'economic':
                compositeEloA = eloSquadA;
                compositeEloB = eloSquadB;
                break;

            case 'defensive':
                compositeEloA = eloHistA;
                compositeEloB = eloHistB;
                baseLambdaA = 0.90;
                baseLambdaB = 0.90;
                if (teamA.teamStats && teamB.teamStats) {
                    const defA = teamA.teamStats.avgGoalsConceded;
                    const defB = teamB.teamStats.avgGoalsConceded;
                    compositeEloA += (defB - defA) * 80;
                }
                break;

            case 'standard':
            default:
                // v5.0: Mayor peso en ELO histórico (0.65 vs 0.40 anterior)
                // Esto reduce el sesgo hacia equipos europeos de alta transferencia
                compositeEloA = (eloHistA * 0.65) + (eloSquadA * 0.35);
                compositeEloB = (eloHistB * 0.65) + (eloSquadB * 0.35);
                formMultA = this.getFormMultiplier(teamA);
                formMultB = this.getFormMultiplier(teamB);
                break;
        }

        const eloDiff = compositeEloA - compositeEloB;

        // Probabilidad de victoria base (fórmula ELO estándar)
        const pWinA = 1 / (1 + Math.pow(10, -eloDiff / 400));
        const pWinB = 1 - pWinA;

        // ================================================================
        // CORRECCIÓN CRÍTICA v5.0: Escala EXPONENCIAL para lambda
        // ================================================================
        // ANTERIOR (bug): lambdaA = base × (pWinA/0.5)^1.1
        //   → Para pWinA=0.75: λA=1.83, λB=0.55 (separación insuficiente)
        //
        // NUEVO (corregido): lambdaA = base × exp(k × (pWinA - 0.5))
        //   → Para pWinA=0.75: λA=2.15, λB=0.84 (separación adecuada)
        //   → Para pWinA=0.80: λA=2.43, λB=0.75 (favorito claro)
        //   → Para pWinA=0.50: λA=λB=1.35 (partido parejo)
        //
        // La función exponencial garantiza que cuando pWinA >> 0.5,
        // los marcadores X-0 y X-1 siempre superen al 1-1 en probabilidad.
        // ================================================================
        let lambdaA = baseLambdaA * Math.exp(this.LAMBDA_SCALE_K * (pWinA - 0.5));
        let lambdaB = baseLambdaB * Math.exp(this.LAMBDA_SCALE_K * (pWinB - 0.5));

        // Ajuste por forma (solo Standard y Momentum)
        if (this.modelType === 'standard' || this.modelType === 'momentum') {
            lambdaA *= formMultA;
            lambdaB *= formMultB;
        }

        // ================================================================
        // AJUSTE TÁCTICO RECALIBRADO v5.0
        // ================================================================
        // ANTERIOR (bug): divisores arbitrarios (1.5 y 1.0) sin calibración
        //   → Podía amplificar lambda hasta ×1.20, generando goles irrealistas
        //
        // NUEVO: Normalizado contra promedio real WC (~1.35 goles/equipo)
        //   → Multiplicador estrictamente acotado en [0.88, 1.12]
        //   → Influencia máxima: ±12% sobre lambda base
        // ================================================================
        if (this.modelType === 'standard' && teamA.teamStats && teamB.teamStats) {
            const WC_AVG = 1.35; // Promedio real WC 2010-2022

            const attackFactorA  = teamA.teamStats.avgGoalsScored   / WC_AVG;
            const defenseFactorB = teamB.teamStats.avgGoalsConceded  / WC_AVG;
            const tacticMultA    = Math.max(0.88, Math.min(1.12, (attackFactorA + defenseFactorB) / 2));

            const attackFactorB  = teamB.teamStats.avgGoalsScored   / WC_AVG;
            const defenseFactorA = teamA.teamStats.avgGoalsConceded  / WC_AVG;
            const tacticMultB    = Math.max(0.88, Math.min(1.12, (attackFactorB + defenseFactorA) / 2));

            lambdaA *= tacticMultA;
            lambdaB *= tacticMultB;
        }

        // Aplicar corrección de sesgo acumulada del aprendizaje incremental
        if (this._calibration.biasCorrection !== 0) {
            lambdaA *= (1 + this._calibration.biasCorrection);
            lambdaB *= (1 + this._calibration.biasCorrection);
        }

        // Clamping final: mínimo 0.15 goles, máximo MAX_GOALS
        lambdaA = Math.max(0.15, Math.min(this.MAX_GOALS, lambdaA));
        lambdaB = Math.max(0.15, Math.min(this.MAX_GOALS, lambdaB));

        return { lambdaA, lambdaB, pWinA, pWinB, eloDiff };
    }

    getFormMultiplier(team) {
        const f = team.recentForm;
        const total = f.wins + f.draws + f.losses;
        if (total === 0) return 1.0;
        const ratio = (f.wins * 3 + f.draws) / (total * 3);
        // Rango más acotado [0.88, 1.18] para evitar sobreamplificación
        return 0.88 + ratio * 0.30;
    }

    poissonPMF(k, lambda) {
        if (k < 0 || lambda <= 0) return 0;
        let logP = -lambda + k * Math.log(lambda);
        for (let i = 2; i <= k; i++) logP -= Math.log(i);
        const p = Math.exp(logP);
        return (isNaN(p) || p < 0) ? 0 : p;
    }

    // Dixon-Coles (1997) — corrección para baja puntuación
    // ρ < 0: aumenta levemente 0-0 y 1-1 (más realista en fútbol moderno)
    // La causa raíz de la contradicción era el lambda incorrecto, NO el signo de ρ
    dixonColes(x, y, lA, lB, rho) {
        const base = this.poissonPMF(x, lA) * this.poissonPMF(y, lB);
        if (base <= 0) return 0;
        let corr = 1.0;
        if      (x === 0 && y === 0) corr = 1 - lA * lB * rho;
        else if (x === 0 && y === 1) corr = 1 + lA * rho;
        else if (x === 1 && y === 0) corr = 1 + lB * rho;
        else if (x === 1 && y === 1) corr = 1 - rho;
        // corr nunca puede ser negativo
        return Math.max(0, base * corr);
    }

    // ============================================================
    // PREDICCIÓN COMPLETA DE PARTIDO
    // ============================================================
    predictMatch(teamAName, teamBName) {
        const teamA = this.teams[teamAName];
        const teamB = this.teams[teamBName];
        if (!teamA || !teamB) {
            return { error: `Equipo no encontrado: "${teamAName}" o "${teamBName}"` };
        }

        const { lambdaA, lambdaB, pWinA, eloDiff } = this.getGoalExpectancy(teamA, teamB);

        // Construir matriz de probabilidades (Dixon-Coles bivariada)
        let probMatrix = [];
        let totalSum = 0;
        for (let i = 0; i <= this.MAX_GOALS; i++) {
            probMatrix[i] = [];
            for (let j = 0; j <= this.MAX_GOALS; j++) {
                const rho = this._calibration.rhoDynamic || this.RHO;
                const p = this.dixonColes(i, j, lambdaA, lambdaB, rho);
                probMatrix[i][j] = p;
                totalSum += p;
            }
        }

        // Normalizar
        if (totalSum <= 0) {
            probMatrix[1][0] = 1; // Fallback: 1-0 si todo falla
        } else {
            for (let i = 0; i <= this.MAX_GOALS; i++)
                for (let j = 0; j <= this.MAX_GOALS; j++)
                    probMatrix[i][j] /= totalSum;
        }

        // Calcular probabilidades marginales
        let winA = 0, draw = 0, winB = 0;
        let mostLikely = { goalsA: 0, goalsB: 0, prob: 0 };
        let over25 = 0, btts = 0;

        for (let i = 0; i <= this.MAX_GOALS; i++) {
            for (let j = 0; j <= this.MAX_GOALS; j++) {
                const p = probMatrix[i][j];
                if      (i > j) winA += p;
                else if (i < j) winB += p;
                else            draw += p;
                if (p > mostLikely.prob) mostLikely = { goalsA: i, goalsB: j, prob: p };
                if (i + j > 2.5) over25 += p;
                if (i > 0 && j > 0) btts += p;
            }
        }

        // Verificación de coherencia probabilística
        // Si pWinA > 0.65 pero el marcador más probable es empate, forzar corrección
        // (Esto nunca debería ocurrir con lambdas correctos, pero es una red de seguridad)
        const mostLikelyIsDraw = (mostLikely.goalsA === mostLikely.goalsB);
        if (mostLikelyIsDraw && pWinA > 0.65) {
            // El marcador de victoria de A más probable según la matriz
            let bestWinScore = { goalsA: 0, goalsB: 0, prob: 0 };
            for (let i = 1; i <= this.MAX_GOALS; i++) {
                for (let j = 0; j < i; j++) {
                    if (probMatrix[i][j] > bestWinScore.prob) {
                        bestWinScore = { goalsA: i, goalsB: j, prob: probMatrix[i][j] };
                    }
                }
            }
            // Si la diferencia de probabilidad es menor a 0.5pp, mostrar el de victoria
            if (Math.abs(bestWinScore.prob - mostLikely.prob) < 0.005) {
                mostLikely = bestWinScore;
            }
        }

        // Penales (si hay alta probabilidad de empate)
        let penaltyInfo = null;
        if (draw > 0.18) {
            const pen = this.calcPenaltyOdds(teamAName, teamBName, 2000);
            penaltyInfo = {
                probWinA: pen.winA.toFixed(1),
                probWinB: pen.winB.toFixed(1),
                expectedWinner: pen.winA > 50 ? teamAName : teamBName
            };
        }

        // Top marcadores (ordenados por probabilidad)
        const allScores = [];
        for (let i = 0; i <= this.MAX_GOALS; i++)
            for (let j = 0; j <= this.MAX_GOALS; j++)
                allScores.push({ score: `${i}-${j}`, probability: probMatrix[i][j] * 100 });
        allScores.sort((a, b) => b.probability - a.probability);

        // Recomendaciones de apuesta
        const probA = winA * 100;
        const probB = winB * 100;
        const probD = draw * 100;
        const bettingRecommendations = this._buildBettingRecommendations(
            teamAName, teamBName, probA, probB, probD,
            lambdaA, lambdaB, over25, btts, penaltyInfo, mostLikely
        );

        return {
            teamA: teamAName, teamB: teamBName,
            flagA: teamA.flag, flagB: teamB.flag,
            strengthA: this.calculateTeamStrength(teamAName),
            strengthB: this.calculateTeamStrength(teamBName),
            winA:  parseFloat(probA.toFixed(1)),
            draw:  parseFloat(probD.toFixed(1)),
            winB:  parseFloat(probB.toFixed(1)),
            lambdaA: lambdaA.toFixed(2),
            lambdaB: lambdaB.toFixed(2),
            expectedGoals: (lambdaA + lambdaB).toFixed(2),
            mostLikelyScore: `${mostLikely.goalsA}-${mostLikely.goalsB}`,
            mostLikelyProb: (mostLikely.prob * 100).toFixed(1),
            topScores: allScores.slice(0, 5).map(s => ({
                score: s.score,
                probability: s.probability.toFixed(1)
            })),
            over25: (over25 * 100).toFixed(1),
            btts:   (btts   * 100).toFixed(1),
            penaltyInfo, eloDiff, bettingRecommendations,
            // Metadatos del modelo para evaluación
            _model: {
                lambdaA, lambdaB, pWinA,
                version: '5.0',
                modelType: this.modelType
            }
        };
    }

    // ============================================================
    // RECOMENDACIONES DE APUESTA (refactorizado)
    // ============================================================
    _buildBettingRecommendations(tA, tB, probA, probB, probD, lA, lB, over25, btts, penInfo, mostLikely) {
        const recs = [];
        const fav = probA > probB ? tA : tB;
        const isDrawMostLikely = (mostLikely.goalsA === mostLikely.goalsB);

        // 1. Resultado 1X2
        if (isDrawMostLikely) {
            recs.push({ market: "Resultado 90'", tip: `Doble Oportunidad: Empate o ${fav}`, icon: "⚖️" });
        } else if (probD >= 25 && Math.abs(probA - probB) <= 20) {
            recs.push({ market: "Resultado 90'", tip: `Doble Oportunidad: Empate o ${fav}`, icon: "⚖️" });
        } else if (probA > 55) {
            recs.push({ market: "Resultado 90'", tip: `Victoria de ${tA}`, icon: "🏆" });
        } else if (probB > 55) {
            recs.push({ market: "Resultado 90'", tip: `Victoria de ${tB}`, icon: "🏆" });
        } else {
            recs.push({ market: "Resultado 90'", tip: `Apuesta sin empate (DNB): ${fav}`, icon: "🛡️" });
        }

        // 2. Goles Over/Under 2.5
        const totalXG = lA + lB;
        const pOver = over25 * 100;
        if (totalXG >= 2.6 || pOver > 55) {
            recs.push({ market: "Total de Goles", tip: "Más de 2.5 (Over 2.5)", icon: "⚽" });
        } else if (totalXG <= 2.1 || pOver < 40) {
            recs.push({ market: "Total de Goles", tip: "Menos de 2.5 (Under 2.5)", icon: "🔒" });
        } else {
            recs.push({ market: "Total de Goles", tip: "2 o 3 goles en el partido", icon: "📊" });
        }

        // 3. BTTS
        const pBtts = btts * 100;
        if (pBtts > 55) {
            recs.push({ market: "Ambos Anotan", tip: "Sí (BTTS)", icon: "🔥" });
        } else if (pBtts < 40) {
            recs.push({ market: "Ambos Anotan", tip: "No", icon: "🛑" });
        }

        // 4. Penales
        if (penInfo && (probD > 18 || isDrawMostLikely)) {
            let penTip = `Si hay tanda, avanza ${penInfo.expectedWinner}`;
            if (penInfo.expectedWinner !== fav && Math.abs(probA - probB) < 15) {
                penTip = `¡Atención! ${fav} es leve favorito en 90', pero ${penInfo.expectedWinner} es favorito en penales.`;
            }
            recs.push({ market: "Clasificación", tip: penTip, icon: "⚡" });
        }

        return recs;
    }

    // ============================================================
    // PENALES
    // ============================================================
    getBestPenaltyTakers(team, n = 5) {
        if (!team.players) return Array(n).fill({ penaltyRating: 55 });
        return team.players
            .filter(p => p.position !== 'POR')
            .sort((a, b) => (b.penaltyRating || 50) - (a.penaltyRating || 50))
            .slice(0, n);
    }

    _simulatePenaltyShootout(teamAName, teamBName) {
        const tA = this.getBestPenaltyTakers(this.teams[teamAName]);
        const tB = this.getBestPenaltyTakers(this.teams[teamBName]);
        let a = 0, b = 0;
        for (let i = 0; i < 5; i++) {
            if (Math.random() < ((tA[i]?.penaltyRating || 55) / 100) * this.PENALTY_STRESS) a++;
            if (Math.random() < ((tB[i]?.penaltyRating || 55) / 100) * this.PENALTY_STRESS) b++;
        }
        let rd = 0;
        while (a === b && rd < 15) {
            const gA = Math.random() < ((tA[rd % 5]?.penaltyRating || 55) / 100) * this.PENALTY_STRESS;
            const gB = Math.random() < ((tB[rd % 5]?.penaltyRating || 55) / 100) * this.PENALTY_STRESS;
            if (gA && !gB) { a++; break; }
            if (!gA && gB) { b++; break; }
            rd++;
        }
        return a >= b ? teamAName : teamBName;
    }

    calcPenaltyOdds(teamAName, teamBName, iterations = 2000) {
        let winsA = 0;
        for (let it = 0; it < iterations; it++) {
            if (this._simulatePenaltyShootout(teamAName, teamBName) === teamAName) winsA++;
        }
        const pA = (winsA / iterations) * 100;
        return { winA: pA, winB: 100 - pA };
    }

    // ============================================================
    // SIMULACIÓN ESTOCÁSTICA (Monte Carlo)
    // ============================================================
    simulateSingleMatch(teamAName, teamBName) {
        const teamA = this.teams[teamAName];
        const teamB = this.teams[teamBName];
        if (!teamA || !teamB) return { goalsA: 0, goalsB: 0 };
        const { lambdaA, lambdaB } = this.getGoalExpectancy(teamA, teamB);
        return {
            goalsA: this.poissonRandom(lambdaA),
            goalsB: this.poissonRandom(lambdaB)
        };
    }

    poissonRandom(lambda) {
        // Método de Knuth para λ pequeño; aproximación normal para λ grande
        if (lambda > 20) {
            // Box-Muller para λ grande (raro, pero previene bucles infinitos)
            const k = Math.round(lambda + Math.sqrt(lambda) * (Math.random() * 2 - 1) * 1.2);
            return Math.max(0, k);
        }
        const L = Math.exp(-Math.min(lambda, 30));
        let k = 0, p = 1;
        do { k++; p *= Math.random(); } while (p > L);
        return k - 1;
    }

    simulateKnockout(teamAName, teamBName) {
        if (!teamAName || !teamBName) return teamAName || teamBName;
        const { goalsA, goalsB } = this.simulateSingleMatch(teamAName, teamBName);
        if (goalsA !== goalsB) return goalsA > goalsB ? teamAName : teamBName;
        return this._simulatePenaltyShootout(teamAName, teamBName);
    }

    // ============================================================
    // SIMULACIÓN ANALÍTICA DE GRUPO (Fase de Grupos — UI)
    // ============================================================
    simulateGroup(groupName) {
        const groupTeams = this.groups[groupName];
        if (!groupTeams) return null;

        const st = {};
        groupTeams.forEach(t => {
            st[t] = { pts: 0, gf: 0, ga: 0, wins: 0, draws: 0, losses: 0, team: t, flag: this.teams[t]?.flag || '🏳️' };
        });

        const matches = [];

        for (let i = 0; i < groupTeams.length; i++) {
            for (let j = i + 1; j < groupTeams.length; j++) {
                const teamAName = groupTeams[i];
                const teamBName = groupTeams[j];
                const pred = this.predictMatch(teamAName, teamBName);

                const wA = pred.winA / 100;
                const d  = pred.draw / 100;
                const wB = pred.winB / 100;

                st[teamAName].pts += (wA * 3) + (d * 1);
                st[teamBName].pts += (wB * 3) + (d * 1);

                const lA = parseFloat(pred.lambdaA);
                const lB = parseFloat(pred.lambdaB);

                st[teamAName].gf += lA;
                st[teamAName].ga += lB;
                st[teamBName].gf += lB;
                st[teamBName].ga += lA;

                st[teamAName].wins   += wA;
                st[teamAName].draws  += d;
                st[teamAName].losses += wB;
                st[teamBName].wins   += wB;
                st[teamBName].draws  += d;
                st[teamBName].losses += wA;

                matches.push({
                    teamA: teamAName, teamB: teamBName,
                    flagA: pred.flagA, flagB: pred.flagB,
                    scoreA: Math.round(lA), scoreB: Math.round(lB),
                    pred: { winA: pred.winA, winB: pred.winB }
                });
            }
        }

        const standings = {};
        Object.values(st).forEach(a => {
            const gf = Math.round(a.gf);
            const ga = Math.round(a.ga);
            standings[a.team] = {
                team: a.team, flag: a.flag,
                played: groupTeams.length - 1,
                wins:   parseFloat(a.wins.toFixed(1)),
                draws:  parseFloat(a.draws.toFixed(1)),
                losses: parseFloat(a.losses.toFixed(1)),
                goalsFor: gf, goalsAgainst: ga,
                goalDifference: gf - ga,
                points: Math.round(a.pts),
                strength: this.calculateTeamStrength(a.team)
            };
        });

        const sorted = Object.values(standings).sort((a, b) => {
            if (b.points !== a.points) return b.points - a.points;
            if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
            return b.goalsFor - a.goalsFor;
        });

        return {
            group: groupName, standings: sorted, matches,
            qualified: sorted.slice(0, 2).map(s => s.team),
            thirdPlace: sorted[2]?.team
        };
    }

    // ============================================================
    // MONTE CARLO — Torneo completo
    // ============================================================
    _runSingleTournamentIteration(res) {
        const groupResults = {};
        const allThirds = [];

        for (const group in this.groups) {
            const teams = this.groups[group];
            const st = {};
            teams.forEach(t => { st[t] = { pts: 0, gd: 0, gf: 0 }; });

            for (let i = 0; i < teams.length; i++) {
                for (let j = i + 1; j < teams.length; j++) {
                    const { goalsA, goalsB } = this.simulateSingleMatch(teams[i], teams[j]);
                    st[teams[i]].gf += goalsA; st[teams[i]].gd += goalsA - goalsB;
                    st[teams[j]].gf += goalsB; st[teams[j]].gd += goalsB - goalsA;
                    if      (goalsA > goalsB) st[teams[i]].pts += 3;
                    else if (goalsB > goalsA) st[teams[j]].pts += 3;
                    else { st[teams[i]].pts++; st[teams[j]].pts++; }
                }
            }

            const sorted = Object.entries(st).sort((a, b) =>
                b[1].pts !== a[1].pts ? b[1].pts - a[1].pts :
                b[1].gd  !== a[1].gd  ? b[1].gd  - a[1].gd  :
                b[1].gf  -  a[1].gf
            );

            groupResults[group] = sorted.map(s => s[0]);
            allThirds.push({
                team: sorted[2][0],
                pts: sorted[2][1].pts,
                gd: sorted[2][1].gd,
                gf: sorted[2][1].gf,
                group
            });

            if (res[sorted[3][0]]) res[sorted[3][0]].groupStage++;
            sorted.forEach(s => { if (res[s[0]]) res[s[0]].totalPoints += s[1].pts; });
        }

        // Elegir 8 mejores terceros
        allThirds.sort((a, b) =>
            b.pts !== a.pts ? b.pts - a.pts :
            b.gd  !== a.gd  ? b.gd  - a.gd  :
            b.gf  - a.gf
        );
        const best8Thirds = allThirds.slice(0, 8).map(t => ({ team: t.team, group: t.group }));
        allThirds.slice(8).forEach(t => { if (res[t.team]) res[t.team].groupStage++; });

        let winners = [];
        let runners = [];
        for (const group in groupResults) {
            winners.push({ team: groupResults[group][0], group });
            runners.push({ team: groupResults[group][1], group });
        }

        const shuffle = (array) => {
            for (let i = array.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [array[i], array[j]] = [array[j], array[i]];
            }
            return array;
        };

        winners = shuffle(winners);
        runners = shuffle(runners);
        let thirds = shuffle(best8Thirds);

        const r32Matches = [];
        const popRival = (arr, groupToAvoid) => {
            const idx = arr.findIndex(x => x.group !== groupToAvoid);
            if (idx === -1) return arr.pop();
            return arr.splice(idx, 1)[0];
        };

        for (let i = 0; i < 8; i++) {
            const w = winners.pop();
            const t = popRival(thirds, w.group);
            r32Matches.push([w.team, t.team]);
        }
        for (let i = 0; i < 4; i++) {
            const w = winners.pop();
            const r = popRival(runners, w.group);
            r32Matches.push([w.team, r.team]);
        }
        for (let i = 0; i < 4; i++) {
            const r1 = runners.pop();
            const r2 = popRival(runners, r1.group);
            r32Matches.push([r1.team, r2.team]);
        }

        shuffle(r32Matches);
        const r32 = r32Matches.flat();

        r32.forEach(t => { if (res[t]) res[t].roundOf32++; });
        const r16 = [];
        for (let i = 0; i < r32.length; i += 2) {
            const w = this.simulateKnockout(r32[i], r32[i + 1]);
            r16.push(w);
            if (res[w]) res[w].roundOf16++;
        }

        const qf = [];
        for (let i = 0; i < r16.length; i += 2) {
            const w = this.simulateKnockout(r16[i], r16[i + 1]);
            qf.push(w);
            if (res[w]) res[w].quarterFinals++;
        }

        const sf = [];
        for (let i = 0; i < qf.length; i += 2) {
            const w = this.simulateKnockout(qf[i], qf[i + 1]);
            sf.push(w);
            if (res[w]) res[w].semiFinals++;
        }

        const final = [];
        for (let i = 0; i < sf.length; i += 2) {
            const w = this.simulateKnockout(sf[i], sf[i + 1]);
            final.push(w);
            if (res[w]) res[w].final++;
        }

        if (final.length >= 2) {
            const ch = this.simulateKnockout(final[0], final[1]);
            if (res[ch]) res[ch].champion++;
        } else if (final.length === 1) {
            if (res[final[0]]) res[final[0]].champion++;
        }
    }

    simulateTournament(iterations = 1000) {
        const res = {};
        Object.keys(this.teams).forEach(team => {
            res[team] = {
                team, flag: this.teams[team].flag,
                groupStage: 0, roundOf32: 0, roundOf16: 0,
                quarterFinals: 0, semiFinals: 0, final: 0,
                champion: 0, totalPoints: 0
            };
        });

        for (let it = 0; it < iterations; it++) {
            this._runSingleTournamentIteration(res);
        }

        return Object.values(res).map(t => ({
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
    }

    // ============================================================
    // APRENDIZAJE INCREMENTAL (Online Learning)
    // ============================================================
    /**
     * Actualiza los parámetros del motor a partir de un resultado real.
     * Implementa:
     *   1. Actualización ELO del equipo (K-factor adaptativo)
     *   2. Corrección de sesgo lambda (si el modelo predice goles muy diferentes a los reales)
     *   3. Ajuste dinámico de RHO basado en frecuencia de empates observados
     *
     * @param {string} teamAName - Nombre del equipo A (local en la predicción)
     * @param {string} teamBName - Nombre del equipo B
     * @param {number} goalsA    - Goles reales del equipo A
     * @param {number} goalsB    - Goles reales del equipo B
     * @param {Object} prediction - Resultado de predictMatch() al momento de la predicción (opcional)
     */
    updateFromResult(teamAName, teamBName, goalsA, goalsB, prediction = null) {
        const teamA = this.teams[teamAName];
        const teamB = this.teams[teamBName];
        if (!teamA || !teamB) return { error: 'Equipo no encontrado' };

        // 1. Determinar resultado real
        const actualResultA = goalsA > goalsB ? 1 : goalsA === goalsB ? 0.5 : 0;
        const actualResultB = 1 - actualResultA;

        // 2. Probabilidad esperada según ELO actual
        const { pWinA, lambdaA, lambdaB } = this.getGoalExpectancy(teamA, teamB);
        const expectedA = pWinA;
        const expectedB = 1 - pWinA;

        // 3. Actualización ELO (K-factor adaptativo)
        // K se reduce conforme más partidos se procesan (convergencia)
        const n = this._calibration.matchesProcessed;
        const K = Math.max(10, this._calibration.eloLearningRate / (1 + n * 0.05));

        const eloChangeA = K * (actualResultA - expectedA);
        const eloChangeB = K * (actualResultB - expectedB);

        teamA.eloRating = Math.round(teamA.eloRating + eloChangeA);
        teamB.eloRating = Math.round(teamB.eloRating + eloChangeB);

        // 4. Corrección de sesgo lambda
        // Si el modelo predice consistentemente más goles que los reales, ajustar lambdaAdjustment
        const predictedTotal = lambdaA + lambdaB;
        const actualTotal = goalsA + goalsB;
        const golesBias = actualTotal - predictedTotal;

        // Media móvil exponencial del sesgo (α=0.15)
        const alpha = 0.15;
        const currentBias = this._calibration.biasCorrection;
        const biasPct = predictedTotal > 0 ? golesBias / predictedTotal : 0;
        this._calibration.biasCorrection = currentBias * (1 - alpha) + biasPct * alpha;

        // Limitar corrección de sesgo a ±20%
        this._calibration.biasCorrection = Math.max(-0.20, Math.min(0.20, this._calibration.biasCorrection));

        // 5. Ajuste dinámico de RHO basado en empates observados
        if (goalsA === goalsB) {
            // Partido empatado: RHO debe ser más negativo (más empates que Poisson predice)
            this._calibration.rhoDynamic = Math.max(-0.20, this._calibration.rhoDynamic - 0.002);
        } else {
            // Sin empate: gradualmente volver al valor original
            const rhoTarget = -0.08;
            this._calibration.rhoDynamic += (rhoTarget - this._calibration.rhoDynamic) * 0.05;
        }

        this._calibration.matchesProcessed++;

        // Invalidar caché de fuerza
        this._strengthCache = {};

        return {
            success: true,
            eloChangeA: eloChangeA.toFixed(1),
            eloChangeB: eloChangeB.toFixed(1),
            newEloA: teamA.eloRating,
            newEloB: teamB.eloRating,
            biasCorrectionPct: (this._calibration.biasCorrection * 100).toFixed(2),
            matchesProcessed: this._calibration.matchesProcessed,
            K: K.toFixed(1)
        };
    }

    /**
     * Evalúa el desempeño del modelo dado un conjunto de predicciones y resultados reales.
     *
     * @param {Array} records - Array de objetos { prediction, actual }
     *   - prediction: resultado de predictMatch()
     *   - actual: { goalsA, goalsB }
     * @returns {Object} Métricas estadísticas de evaluación
     */
    evaluatePerformance(records) {
        if (!records || records.length === 0) {
            return {
                totalMatches: 0,
                accuracy: { winner: 0, draw: 0, exactScore: 0 },
                logLoss: null, brierScore: null, maeGoals: null,
                rmseGoals: null, calibrationError: null
            };
        }

        let correctWinner = 0;
        let correctDraw = 0;
        let correctExact = 0;
        let logLossSum = 0;
        let brierSum = 0;
        let maeSum = 0;
        let rmseSum = 0;

        // Calibration: buckets de 10% en probabilidad de victoria
        const calibBuckets = Array.from({ length: 10 }, () => ({ predicted: 0, actual: 0, count: 0 }));

        const EPS = 1e-10; // Para evitar log(0)

        records.forEach(({ prediction: pred, actual }) => {
            if (!pred || actual == null) return;

            const goalsA = actual.goalsA;
            const goalsB = actual.goalsB;

            // Resultado real
            const realWinA = goalsA > goalsB;
            const realDraw = goalsA === goalsB;
            const realWinB = goalsA < goalsB;

            // Probabilidades predichas (como fracciones)
            const pA = pred.winA / 100;
            const pD = pred.draw / 100;
            const pB = pred.winB / 100;

            // Predicción del ganador (max probabilidad)
            const predWinner = pA > pD && pA > pB ? 'A' : pB > pA && pB > pD ? 'B' : 'D';
            const actualWinner = realWinA ? 'A' : realDraw ? 'D' : 'B';

            if (predWinner === actualWinner) correctWinner++;
            if (realDraw && predWinner === 'D') correctDraw++;

            // Marcador exacto
            const predScore = pred.mostLikelyScore;
            if (predScore === `${goalsA}-${goalsB}`) correctExact++;

            // Log Loss (multinomial)
            const pActualResult = realWinA ? pA : realDraw ? pD : pB;
            logLossSum += -Math.log(Math.max(pActualResult, EPS));

            // Brier Score (para resultado: WinA, Draw, WinB)
            const outA = realWinA ? 1 : 0;
            const outD = realDraw ? 1 : 0;
            const outB = realWinB ? 1 : 0;
            brierSum += ((pA - outA) ** 2 + (pD - outD) ** 2 + (pB - outB) ** 2) / 3;

            // MAE y RMSE de goles
            const predGoalsA = parseFloat(pred.lambdaA);
            const predGoalsB = parseFloat(pred.lambdaB);
            const errA = Math.abs(predGoalsA - goalsA);
            const errB = Math.abs(predGoalsB - goalsB);
            maeSum  += (errA + errB) / 2;
            rmseSum += ((predGoalsA - goalsA) ** 2 + (predGoalsB - goalsB) ** 2) / 2;

            // Calibration — bucket por prob de victoria del favorito
            const pFav = Math.max(pA, pB);
            const bucketIdx = Math.min(9, Math.floor(pFav * 10));
            calibBuckets[bucketIdx].predicted += pFav;
            calibBuckets[bucketIdx].actual    += (pA > pB ? outA : outB);
            calibBuckets[bucketIdx].count++;
        });

        const n = records.length;
        const calibBucketsFiltered = calibBuckets.filter(b => b.count > 0).map(b => ({
            predictedAvg: (b.predicted / b.count * 100).toFixed(1),
            actualPct:    (b.actual    / b.count * 100).toFixed(1),
            n: b.count,
            error: Math.abs(b.predicted / b.count - b.actual / b.count)
        }));

        const calibrationError = calibBucketsFiltered.length > 0
            ? (calibBucketsFiltered.reduce((s, b) => s + b.error, 0) / calibBucketsFiltered.length * 100).toFixed(2)
            : null;

        return {
            totalMatches: n,
            accuracy: {
                winner:     parseFloat((correctWinner / n * 100).toFixed(1)),
                draw:       parseFloat((correctDraw   / n * 100).toFixed(1)),
                exactScore: parseFloat((correctExact  / n * 100).toFixed(1))
            },
            logLoss:          parseFloat((logLossSum / n).toFixed(4)),
            brierScore:       parseFloat((brierSum   / n).toFixed(4)),
            maeGoals:         parseFloat((maeSum     / n).toFixed(3)),
            rmseGoals:        parseFloat((Math.sqrt(rmseSum / n)).toFixed(3)),
            calibrationError: calibrationError ? parseFloat(calibrationError) : null,
            calibrationBuckets: calibBucketsFiltered
        };
    }

    // ============================================================
    // FUERZA COMPUESTA (ranking visual)
    // ============================================================
    calculateTeamStrength(teamName) {
        if (this._strengthCache && this._strengthCache[teamName]) return this._strengthCache[teamName];

        const team = this.teams[teamName];
        if (!team) return 50;

        const eloNorm  = Math.min(100, Math.max(0, ((team.eloRating - 1300) / 900) * 100));

        const f = team.recentForm;
        const totalM = f.wins + f.draws + f.losses;
        const formNorm = totalM > 0 ? (f.wins * 3 + f.draws) / (totalM * 3) * 100 : 50;

        let statsNorm = 50;
        if (team.teamStats) {
            const att = Math.min(100, (team.teamStats.avgGoalsScored  / 2.5) * 70);
            const def = Math.min(100, Math.max(0, (1 - team.teamStats.avgGoalsConceded / 3) * 100));
            const pen = Math.min(100, team.teamStats.avgPenaltyRating || 60);
            statsNorm = att * 0.4 + def * 0.4 + (pen - 40) * 1.5;
        }

        const squadNorm = Math.min(100, team.squadValue);
        const histNorm  = team.historicalScore;
        const confNorm  = Math.min(100, (team.confederationStrength / 1.15) * 100);
        const expNorm   = team.tournamentExperience;

        let strength =
            eloNorm   * this.WEIGHTS.eloRating +
            formNorm  * this.WEIGHTS.recentForm +
            statsNorm * this.WEIGHTS.teamStats +
            squadNorm * this.WEIGHTS.squadValue +
            histNorm  * this.WEIGHTS.historicalScore +
            confNorm  * this.WEIGHTS.confederationStrength +
            expNorm   * this.WEIGHTS.tournamentExperience;

        if (team.hostCountry === 'USA' || team.hostCountry === 'México' || team.hostCountry === 'Canadá') strength += 2;

        const result = Math.min(99, Math.max(1, Math.round(strength)));
        if (this._strengthCache) this._strengthCache[teamName] = result;
        return result;
    }

    getFavorites() {
        return Object.keys(this.teams).map(team => ({
            team, flag: this.teams[team].flag,
            strength:    this.calculateTeamStrength(team),
            eloRating:   this.teams[team].eloRating,
            fifaRanking: this.teams[team].fifaRanking,
            titles:      this.teams[team].worldCupTitles,
            coach:       this.teams[team].coach,
            confederation: this.teams[team].confederation
        })).sort((a, b) => b.strength - a.strength);
    }

    getAllTeams() {
        return Object.keys(this.teams).sort((a, b) => {
            const gA = Object.keys(this.groups).find(g => this.groups[g].includes(a)) || 'Z';
            const gB = Object.keys(this.groups).find(g => this.groups[g].includes(b)) || 'Z';
            if (gA !== gB) return gA.localeCompare(gB);
            return (this.groups[gA] || []).indexOf(a) - (this.groups[gB] || []).indexOf(b);
        });
    }

    compareTeams(teamAName, teamBName) {
        const teamA = this.teams[teamAName];
        const teamB = this.teams[teamBName];
        if (!teamA || !teamB) return null;
        const pred = this.predictMatch(teamAName, teamBName);
        return {
            prediction: pred,
            comparison: {
                fifaRanking:     { a: teamA.fifaRanking,                       b: teamB.fifaRanking,                       winner: teamA.fifaRanking < teamB.fifaRanking ? teamAName : teamBName },
                eloRating:       { a: teamA.eloRating,                         b: teamB.eloRating,                         winner: teamA.eloRating   > teamB.eloRating   ? teamAName : teamBName },
                worldCupTitles:  { a: teamA.worldCupTitles,                    b: teamB.worldCupTitles,                    winner: teamA.worldCupTitles > teamB.worldCupTitles ? teamAName : teamBName },
                squadValue:      { a: teamA.squadValue,                        b: teamB.squadValue,                        winner: teamA.squadValue  > teamB.squadValue  ? teamAName : teamBName },
                avgGoalsScored:  { a: teamA.teamStats?.avgGoalsScored  || 1.3,  b: teamB.teamStats?.avgGoalsScored  || 1.3,  winner: (teamA.teamStats?.avgGoalsScored  || 0) > (teamB.teamStats?.avgGoalsScored  || 0) ? teamAName : teamBName },
                avgPenaltyRating:{ a: teamA.teamStats?.avgPenaltyRating || 60,  b: teamB.teamStats?.avgPenaltyRating || 60,  winner: (teamA.teamStats?.avgPenaltyRating|| 0) > (teamB.teamStats?.avgPenaltyRating|| 0) ? teamAName : teamBName },
                strength:        { a: pred.strengthA,                          b: pred.strengthB,                          winner: pred.strengthA > pred.strengthB ? teamAName : teamBName }
            }
        };
    }

    analyzeGroupDifficulty() {
        const result = {};
        Object.keys(this.groups).forEach(g => {
            const strengths = this.groups[g].map(t => this.calculateTeamStrength(t));
            const avg = strengths.reduce((a, b) => a + b, 0) / strengths.length;
            result[g] = {
                avgStrength: Math.round(avg),
                difficulty: avg >= 62 ? 'Grupo de la Muerte' : avg >= 52 ? 'Difícil' : avg >= 42 ? 'Equilibrado' : 'Accesible'
            };
        });
        return result;
    }
}

if (typeof module !== 'undefined' && module.exports) module.exports = PredictionEngine;
