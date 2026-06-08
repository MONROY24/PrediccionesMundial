// ============================================================
// ENGINE.JS - MOTOR PREDICTIVO v4.0 (MUNDIAL 2026)
// Fix: Host bonus reducido, ELOs recalibrados
// Resultados esperados:
//   - Argentina: ~18-22% campeón
//   - Francia/Brasil: ~12-16% campeón  
//   - España/Portugal/Alemania: ~8-12%
//   - USA/México: ~2-4% (anfitriones, boost moderado)
// ============================================================

class PredictionEngine {
    constructor(data, modelType = 'standard') {
        this.data     = data;
        this.teams    = data.teams;
        this.groups   = data.groups;
        this.tournament = data.tournament;
        this.modelType = modelType;
        this._strengthCache = {}; // Caché para memoización

        this.HOST_ELO_BONUS = 30;

        // Parámetros de modelo base
        this.RHO         = -0.08;  // Dixon-Coles ajuste empates bajos
        this.MAX_GOALS   = 8;
        this.BASE_LAMBDA = 1.20;   // Goles base en partido parejo (WC: ~1.2 c/u)
        this.PENALTY_STRESS = 0.80;

        // Pesos para ranking visual
        this.WEIGHTS = {
            eloRating:             0.40,
            recentForm:            0.20,
            teamStats:             0.15,
            squadValue:            0.10,
            historicalScore:       0.08,
            confederationStrength: 0.04,
            tournamentExperience:  0.03
        };
    }

    // ============================================================
    // CÁLCULO DE PROBABILIDADES BASE (Modelo de Poisson Dinámico)
    // ============================================================
    getGoalExpectancy(teamA, teamB) {
        let isLocalA = teamA.hostCountry && !teamB.hostCountry;
        let isLocalB = teamB.hostCountry && !teamA.hostCountry;

        let eloHistA = teamA.eloRating + (isLocalA ? this.HOST_ELO_BONUS : 0);
        let eloHistB = teamB.eloRating + (isLocalB ? this.HOST_ELO_BONUS : 0);

        let eloSquadA = 1300 + (teamA.squadValue * 8.5);
        let eloSquadB = 1300 + (teamB.squadValue * 8.5);

        let compositeEloA, compositeEloB, eloDiff;
        let formMultA = 1.0, formMultB = 1.0;
        let baseLambdaA = this.BASE_LAMBDA, baseLambdaB = this.BASE_LAMBDA;

        // Selección del modelo matemático
        switch(this.modelType) {
            case 'pure_elo':
                // Solo Ranking histórico ELO
                compositeEloA = eloHistA;
                compositeEloB = eloHistB;
                break;
                
            case 'momentum':
                // Rachas: 20% ELO, 80% Forma reciente
                formMultA = this.getFormMultiplier(teamA);
                formMultB = this.getFormMultiplier(teamB);
                compositeEloA = eloHistA * (formMultA * 1.5); // Amplificar racha
                compositeEloB = eloHistB * (formMultB * 1.5);
                break;
                
            case 'economic':
                // El dinero manda: Solo valor de plantilla
                compositeEloA = eloSquadA;
                compositeEloB = eloSquadB;
                break;

            case 'defensive':
                // Sistema ultradefensivo: Menos goles globales, premia al que menos concede
                compositeEloA = eloHistA;
                compositeEloB = eloHistB;
                baseLambdaA = 0.8; // Bajar cantidad de goles
                baseLambdaB = 0.8;
                if (teamA.teamStats && teamB.teamStats) {
                    const defA = teamA.teamStats.avgGoalsConceded;
                    const defB = teamB.teamStats.avgGoalsConceded;
                    // El que concede menos gana puntos extra
                    compositeEloA += (defB - defA) * 100;
                }
                break;

            case 'standard':
            default:
                // Poisson Dixon-Coles balanceado
                compositeEloA = (eloHistA * 0.40) + (eloSquadA * 0.60);
                compositeEloB = (eloHistB * 0.40) + (eloSquadB * 0.60);
                formMultA = this.getFormMultiplier(teamA);
                formMultB = this.getFormMultiplier(teamB);
                break;
        }

        eloDiff = compositeEloA - compositeEloB;
        
        // Probabilidad de victoria base (divisor estándar 400)
        const pWinA   = 1 / (1 + Math.pow(10, -eloDiff / 400));
        const pWinB   = 1 - pWinA;

        // Escalado suave para lambdas de Poisson
        let lambdaA = baseLambdaA * Math.pow(pWinA / 0.5, 1.1);
        let lambdaB = baseLambdaB * Math.pow(pWinB / 0.5, 1.1);

        // Ajuste por forma solo en Standard y Momentum
        if (this.modelType === 'standard' || this.modelType === 'momentum') {
            lambdaA *= formMultA;
            lambdaB *= formMultB;
        }

        // Ajuste táctico solo en Standard
        if (this.modelType === 'standard' && teamA.teamStats && teamB.teamStats) {
            const attackRatioA = teamA.teamStats.avgGoalsScored / 1.5;
            const defenseRatioB = teamB.teamStats.avgGoalsConceded / 1.0;
            lambdaA *= ((attackRatioA + defenseRatioB) / 2) * 0.15 + 0.85;

            const attackRatioB = teamB.teamStats.avgGoalsScored / 1.5;
            const defenseRatioA = teamA.teamStats.avgGoalsConceded / 1.0;
            lambdaB *= ((attackRatioB + defenseRatioA) / 2) * 0.15 + 0.85;
        }

        lambdaA = Math.max(0.1, Math.min(this.MAX_GOALS, lambdaA));
        lambdaB = Math.max(0.1, Math.min(this.MAX_GOALS, lambdaB));

        return { lambdaA, lambdaB, pWinA, pWinB, eloDiff };
    }

    getFormMultiplier(team) {
        const f = team.recentForm;
        const total = f.wins + f.draws + f.losses;
        if (total === 0) return 1.0;
        const ratio = (f.wins * 3 + f.draws) / (total * 3);
        return 0.82 + ratio * 0.40;  // rango 0.82–1.22
    }

    poissonPMF(k, lambda) {
        if (k < 0 || lambda <= 0) return 0;
        let logP = -lambda + k * Math.log(lambda);
        for (let i = 2; i <= k; i++) logP -= Math.log(i);
        const p = Math.exp(logP);
        return (isNaN(p) || p < 0) ? 0 : p;
    }

    dixonColes(x, y, lA, lB, rho) {
        const base = this.poissonPMF(x, lA) * this.poissonPMF(y, lB);
        if (base <= 0) return 0;
        let corr = 1.0;
        if      (x === 0 && y === 0) corr = 1 - lA * lB * rho;
        else if (x === 0 && y === 1) corr = 1 + lA * rho;
        else if (x === 1 && y === 0) corr = 1 + lB * rho;
        else if (x === 1 && y === 1) corr = 1 - rho;
        return Math.max(0, base * corr);
    }

    // ============================================================
    // PREDICCIÓN COMPLETA DE PARTIDO
    // ============================================================
    predictMatch(teamAName, teamBName) {
        const teamA = this.teams[teamAName];
        const teamB = this.teams[teamBName];
        if (!teamA || !teamB) return { error: `Equipo no encontrado: "${teamAName}" o "${teamBName}"` };

        const { lambdaA, lambdaB, pWinA, eloDiff } = this.getGoalExpectancy(teamA, teamB);

        let probMatrix = [], totalSum = 0;
        for (let i = 0; i <= this.MAX_GOALS; i++) {
            probMatrix[i] = [];
            for (let j = 0; j <= this.MAX_GOALS; j++) {
                const p = this.dixonColes(i, j, lambdaA, lambdaB, this.RHO);
                probMatrix[i][j] = p;
                totalSum += p;
            }
        }

        if (totalSum <= 0) {
            for (let i = 0; i <= this.MAX_GOALS; i++)
                for (let j = 0; j <= this.MAX_GOALS; j++)
                    probMatrix[i][j] = (i === 0 && j === 0) ? 1 : 0;
        } else {
            for (let i = 0; i <= this.MAX_GOALS; i++)
                for (let j = 0; j <= this.MAX_GOALS; j++)
                    probMatrix[i][j] /= totalSum;
        }

        let winA = 0, draw = 0, winB = 0;
        let mostLikely = { goalsA: 0, goalsB: 0, prob: 0 };
        let over25 = 0, btts = 0;

        for (let i = 0; i <= this.MAX_GOALS; i++) {
            for (let j = 0; j <= this.MAX_GOALS; j++) {
                const p = probMatrix[i][j];
                if (i > j)      winA += p;
                else if (i < j) winB += p;
                else            draw += p;
                if (p > mostLikely.prob) mostLikely = { goalsA: i, goalsB: j, prob: p };
                if (i + j > 2.5) over25 += p;
                if (i > 0 && j > 0) btts += p;
            }
        }

        const allScores = [];
        for (let i = 0; i <= this.MAX_GOALS; i++)
            for (let j = 0; j <= this.MAX_GOALS; j++)
                allScores.push({ score: `${i}-${j}`, probability: probMatrix[i][j] * 100 });
        allScores.sort((a, b) => b.probability - a.probability);

        let penaltyInfo = null;
        if (draw > 0.18) {
            const pen = this.calcPenaltyOdds(teamAName, teamBName, 2000);
            penaltyInfo = {
                probWinA: pen.winA.toFixed(1),
                probWinB: pen.winB.toFixed(1),
                expectedWinner: pen.winA > 50 ? teamAName : teamBName
            };
        }
        let bettingRecommendations = [];
        const probA = winA * 100;
        const probB = winB * 100;
        const probD = draw * 100;
        const isDrawMostLikely = (mostLikely.goalsA === mostLikely.goalsB);
        const fav = probA > probB ? teamAName : teamBName;
        
        // 1. Mercado de Resultado (1X2 o Doble Oportunidad)
        if (isDrawMostLikely) {
            // Si el marcador más probable es un empate (ej. 1-1), forzar doble oportunidad para no contradecir visualmente
            bettingRecommendations.push({ market: "Resultado 90'", tip: `Doble Oportunidad: Empate o ${fav}`, icon: "⚖️" });
        } else if (probD >= 25 && Math.abs(probA - probB) <= 20) {
            bettingRecommendations.push({ market: "Resultado 90'", tip: `Doble Oportunidad: Empate o ${fav}`, icon: "⚖️" });
        } else if (probA > 55) {
            bettingRecommendations.push({ market: "Resultado 90'", tip: `Victoria de ${teamAName}`, icon: "🏆" });
        } else if (probB > 55) {
            bettingRecommendations.push({ market: "Resultado 90'", tip: `Victoria de ${teamBName}`, icon: "🏆" });
        } else {
            bettingRecommendations.push({ market: "Resultado 90'", tip: `Apuesta sin empate (DNB): ${fav}`, icon: "🛡️" });
        }

        // 2. Mercado de Goles (Over/Under 2.5)
        const totalExpectedGoals = lambdaA + lambdaB;
        const pOver = over25 * 100;
        if (totalExpectedGoals >= 2.6 || pOver > 55) {
            bettingRecommendations.push({ market: "Total de Goles", tip: "Más de 2.5 (Over 2.5)", icon: "⚽" });
        } else if (totalExpectedGoals <= 2.1 || pOver < 40) {
            bettingRecommendations.push({ market: "Total de Goles", tip: "Menos de 2.5 (Under 2.5)", icon: "🔒" });
        } else {
            bettingRecommendations.push({ market: "Total de Goles", tip: "2 o 3 goles en el partido", icon: "📊" });
        }

        // 3. Ambos Anotan (BTTS)
        const pBtts = btts * 100;
        if (pBtts > 55) {
            bettingRecommendations.push({ market: "Ambos Anotan", tip: "Sí (BTTS)", icon: "🔥" });
        } else if (pBtts < 40) {
            bettingRecommendations.push({ market: "Ambos Anotan", tip: "No", icon: "🛑" });
        }

        // 4. Penales (si aplica)
        if (penaltyInfo && (probD > 18 || isDrawMostLikely)) {
            let penTip = `Si hay tanda, avanza ${penaltyInfo.expectedWinner}`;
            if (penaltyInfo.expectedWinner !== fav && Math.abs(probA - probB) < 15) {
                penTip = `¡Atención! ${fav} es leve favorito en 90', pero ${penaltyInfo.expectedWinner} es favorito en penales.`;
            }
            bettingRecommendations.push({ market: "Clasificación", tip: penTip, icon: "⚡" });
        }

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
            topScores: allScores.slice(0, 5).map(s => ({ score: s.score, probability: s.probability.toFixed(1) })),
            over25: (over25 * 100).toFixed(1),
            btts:   (btts   * 100).toFixed(1),
            penaltyInfo, eloDiff, bettingRecommendations
        };
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
    // SIMULACIÓN DE PARTIDO (aleatoria, para Monte Carlo)
    // ============================================================
    simulateSingleMatch(teamAName, teamBName) {
        const teamA = this.teams[teamAName];
        const teamB = this.teams[teamBName];
        if (!teamA || !teamB) return { goalsA: 0, goalsB: 0 };
        const { lambdaA, lambdaB } = this.getGoalExpectancy(teamA, teamB);
        return { goalsA: this.poissonRandom(lambdaA), goalsB: this.poissonRandom(lambdaB) };
    }

    poissonRandom(lambda) {
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
    // SIMULACIÓN DE GRUPO (Analítica para UI, no estocástica)
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
                const d = pred.draw / 100;
                const wB = pred.winB / 100;

                st[teamAName].pts += (wA * 3) + (d * 1);
                st[teamBName].pts += (wB * 3) + (d * 1);

                const lA = parseFloat(pred.lambdaA);
                const lB = parseFloat(pred.lambdaB);
                
                st[teamAName].gf += lA;
                st[teamAName].ga += lB;
                st[teamBName].gf += lB;
                st[teamBName].ga += lA;

                st[teamAName].wins += wA; st[teamAName].draws += d; st[teamAName].losses += wB;
                st[teamBName].wins += wB; st[teamBName].draws += d; st[teamBName].losses += wA;

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
                wins: parseFloat(a.wins.toFixed(1)), 
                draws: parseFloat(a.draws.toFixed(1)), 
                losses: parseFloat(a.losses.toFixed(1)),
                goalsFor: gf, goalsAgainst: ga, goalDifference: gf - ga,
                points: Math.round(a.pts),
                strength: this.calculateTeamStrength(a.team)
            };
        });

        const sorted = Object.values(standings).sort((a, b) => {
            if (b.points !== a.points) return b.points - a.points;
            if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
            return b.goalsFor - a.goalsFor;
        });

        return { group: groupName, standings: sorted, matches,
            qualified: sorted.slice(0, 2).map(s => s.team), thirdPlace: sorted[2]?.team };
    }

    // ============================================================
    // MONTE CARLO — Torneo completo
    // ============================================================
    _runSingleTournamentIteration(res) {
        const groupResults = {};
        const allThirds = [];

        // 1. Simular todos los grupos
        for (const group in this.groups) {
            const teams = this.groups[group];
            const st = {};
            teams.forEach(t => { st[t] = { pts: 0, gd: 0, gf: 0 }; });

            for (let i = 0; i < teams.length; i++) {
                for (let j = i + 1; j < teams.length; j++) {
                    const { goalsA, goalsB } = this.simulateSingleMatch(teams[i], teams[j]);
                    st[teams[i]].gf += goalsA; st[teams[i]].gd += goalsA - goalsB;
                    st[teams[j]].gf += goalsB; st[teams[j]].gd += goalsB - goalsA;
                    if (goalsA > goalsB)      st[teams[i]].pts += 3;
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
            allThirds.push({ team: sorted[2][0], pts: sorted[2][1].pts, gd: sorted[2][1].gd, gf: sorted[2][1].gf, group: group });
            
            // Los 4tos lugares quedan eliminados inmediatamente
            if (res[sorted[3][0]]) res[sorted[3][0]].groupStage++;
            sorted.forEach(s => { if (res[s[0]]) res[s[0]].totalPoints += s[1].pts; });
        }

        // 2. Elegir 8 mejores terceros
        allThirds.sort((a, b) => b.pts !== a.pts ? b.pts - a.pts : b.gd !== a.gd ? b.gd - a.gd : b.gf - a.gf);
        const best8Thirds = allThirds.slice(0, 8).map(t => ({ team: t.team, group: t.group }));
        
        // Los 4 peores terceros quedan eliminados
        allThirds.slice(8).forEach(t => { if (res[t.team]) res[t.team].groupStage++; });

        // 3. Extraer Primeros y Segundos
        let winners = [];
        let runners = [];
        for (const group in groupResults) {
            winners.push({ team: groupResults[group][0], group: group });
            runners.push({ team: groupResults[group][1], group: group });
        }

        // 4. Sorteo Dinámico de Llaves (Aproximación FIFA Oficial)
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
        
        // Helper para encontrar rival que no sea del mismo grupo
        const popRival = (arr, groupToAvoid) => {
            const idx = arr.findIndex(x => x.group !== groupToAvoid);
            if (idx === -1) return arr.pop(); // Fallback
            return arr.splice(idx, 1)[0];
        };

        // 8 Primeros vs 8 Mejores Terceros
        for (let i = 0; i < 8; i++) {
            const w = winners.pop();
            const t = popRival(thirds, w.group);
            r32Matches.push([w.team, t.team]);
        }

        // 4 Primeros vs 4 Segundos
        for (let i = 0; i < 4; i++) {
            const w = winners.pop();
            const r = popRival(runners, w.group);
            r32Matches.push([w.team, r.team]);
        }

        // Quedan 8 Segundos. 8 Segundos vs 8 Segundos.
        for (let i = 0; i < 4; i++) {
            const r1 = runners.pop();
            const r2 = popRival(runners, r1.group);
            r32Matches.push([r1.team, r2.team]);
        }

        // Mezclar las llaves
        shuffle(r32Matches);
        const r32 = r32Matches.flat();

        // Ronda de 32
        r32.forEach(t => { if (res[t]) res[t].roundOf32++; });
        const r16 = [];
        for (let i = 0; i < r32.length; i += 2) {
            const w = this.simulateKnockout(r32[i], r32[i + 1]);
            r16.push(w); if (res[w]) res[w].roundOf16++;
        }

        // Octavos
        const qf = [];
        for (let i = 0; i < r16.length; i += 2) {
            const w = this.simulateKnockout(r16[i], r16[i + 1]);
            qf.push(w); if (res[w]) res[w].quarterFinals++;
        }

        // Cuartos
        const sf = [];
        for (let i = 0; i < qf.length; i += 2) {
            const w = this.simulateKnockout(qf[i], qf[i + 1]);
            sf.push(w); if (res[w]) res[w].semiFinals++;
        }

        // Semis
        const final = [];
        for (let i = 0; i < sf.length; i += 2) {
            const w = this.simulateKnockout(sf[i], sf[i + 1]);
            final.push(w); if (res[w]) res[w].final++;
        }

        // Final
        const ch = this.simulateKnockout(final[0], final[1]);
        if (res[ch]) res[ch].champion++;
    }

    simulateTournament(iterations = 1000) {
        const res = {};
        Object.keys(this.teams).forEach(team => {
            res[team] = { team, flag: this.teams[team].flag,
                groupStage: 0, roundOf32: 0, roundOf16: 0,
                quarterFinals: 0, semiFinals: 0, final: 0,
                champion: 0, totalPoints: 0 };
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
    // FUERZA COMPUESTA (ranking visual)
    // ============================================================
    calculateTeamStrength(teamName) {
        if (this._strengthCache && this._strengthCache[teamName]) return this._strengthCache[teamName];

        const team = this.teams[teamName];
        if (!team) return 50;

        const eloNorm  = Math.min(100, Math.max(0, ((team.eloRating - 1300) / 900) * 100));

        const f = team.recentForm, totalM = f.wins + f.draws + f.losses;
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

        // Bonus anfitrión simbólico (solo +2 en índice visual, no afecta predicciones)
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
                fifaRanking:     { a: teamA.fifaRanking,                      b: teamB.fifaRanking,                      winner: teamA.fifaRanking < teamB.fifaRanking ? teamAName : teamBName },
                eloRating:       { a: teamA.eloRating,                        b: teamB.eloRating,                        winner: teamA.eloRating   > teamB.eloRating   ? teamAName : teamBName },
                worldCupTitles:  { a: teamA.worldCupTitles,                   b: teamB.worldCupTitles,                   winner: teamA.worldCupTitles > teamB.worldCupTitles ? teamAName : teamBName },
                squadValue:      { a: teamA.squadValue,                       b: teamB.squadValue,                       winner: teamA.squadValue  > teamB.squadValue  ? teamAName : teamBName },
                avgGoalsScored:  { a: teamA.teamStats?.avgGoalsScored  || 1.3, b: teamB.teamStats?.avgGoalsScored  || 1.3, winner: (teamA.teamStats?.avgGoalsScored ||0) > (teamB.teamStats?.avgGoalsScored ||0) ? teamAName : teamBName },
                avgPenaltyRating:{ a: teamA.teamStats?.avgPenaltyRating || 60, b: teamB.teamStats?.avgPenaltyRating || 60, winner: (teamA.teamStats?.avgPenaltyRating||0) > (teamB.teamStats?.avgPenaltyRating||0) ? teamAName : teamBName },
                strength:        { a: pred.strengthA,                         b: pred.strengthB,                         winner: pred.strengthA > pred.strengthB ? teamAName : teamBName }
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
