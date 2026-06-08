// ============================================================
// APP.JS - CONTROLADOR PRINCIPAL v4.0 (Mundial 2026)
// ============================================================

function getFlagHtml(emoji, className = 'team-flag-img') {
    if (!emoji) return '🏳️';
    let code = '';
    if (emoji === '🏴󠁧󠁢󠁥󠁮󠁧󠁿') code = 'gb-eng';
    else if (emoji === '🏴󠁧󠁢󠁳󠁣󠁴󠁿') code = 'gb-sct';
    else if (emoji === '🏴󠁧󠁢󠁷󠁬󠁳󠁿') code = 'gb-wls';
    else {
        const c1 = emoji.codePointAt(0);
        const c2 = emoji.codePointAt(2);
        if (c1 >= 0x1F1E6 && c1 <= 0x1F1FF && c2 >= 0x1F1E6 && c2 <= 0x1F1FF) {
            code = String.fromCharCode(c1 - 0x1F1E6 + 97) + String.fromCharCode(c2 - 0x1F1E6 + 97);
        }
    }
    if (code) {
        return `<img src="https://flagcdn.com/w80/${code}.png" class="${className}" alt="${emoji}" style="width: 1.2em; height: auto; border-radius: 2px; vertical-align: middle; box-shadow: 0 1px 3px rgba(0,0,0,0.3);" />`;
    }
    return emoji;
}

let WORLD_CUP_DATA = null;
let engine = null;

// ============================================================
// INICIALIZACIÓN (Asíncrona)
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const response = await fetch('data.json');
        WORLD_CUP_DATA = await response.json();

        // Inicializar banderas HTML
        Object.keys(WORLD_CUP_DATA.teams).forEach(team => {
            WORLD_CUP_DATA.teams[team].flagHtml = getFlagHtml(WORLD_CUP_DATA.teams[team].flag);
        });

        engine = new PredictionEngine(WORLD_CUP_DATA);

        initTabs();
        populateTeamSelectors();
        
        // Procesar URL Compartida
        handleUrlParams();

        renderFavorites();
        renderGroups();
        setupTeamSelectorListeners();
        setupButtons();
    } catch (error) {
        console.error("Error cargando los datos:", error);
        document.body.innerHTML = `<h2 style="color:white;text-align:center;margin-top:50px">⚠️ Error crítico cargando data.json. Asegúrate de estar ejecutando la web a través de un servidor (ej. Live Server o Vercel).</h2>`;
    }
});

function handleUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const teamA = params.get('a');
    const teamB = params.get('b');
    if (teamA && teamB && WORLD_CUP_DATA.teams[teamA] && WORLD_CUP_DATA.teams[teamB]) {
        document.getElementById('teamA-select').value = teamA;
        document.getElementById('teamB-select').value = teamB;
        updateTeamDisplay('A');
        updateTeamDisplay('B');
        setTimeout(() => runPrediction(), 400); // Auto-ejecutar
    }
}

function setupButtons() {
    document.getElementById('predictBtn')?.addEventListener('click', runPrediction);
    document.getElementById('simulateBtn')?.addEventListener('click', runSimulation);
    document.getElementById('shareBtn')?.addEventListener('click', () => {
        const tA = document.getElementById('teamA-select').value;
        const tB = document.getElementById('teamB-select').value;
        if (!tA || !tB) return alert("Selecciona dos equipos primero.");
        const url = new URL(window.location.href);
        url.searchParams.set('a', tA);
        url.searchParams.set('b', tB);
        navigator.clipboard.writeText(url.toString()).then(() => {
            const btn = document.getElementById('shareBtn');
            btn.textContent = '✅';
            setTimeout(() => btn.textContent = '🔗', 2000);
        });
    });
}

// ============================================================
// NAVEGACIÓN POR TABS
// ============================================================
function initTabs() {
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
            tab.classList.add('active');
            const section = document.getElementById(`section-${tab.dataset.tab}`);
            if (section) section.classList.add('active');
        });
    });
}

// ============================================================
// SELECTORES DE EQUIPOS (organizados por grupo)
// ============================================================
function populateTeamSelectors() {
    const selectA = document.getElementById('teamA-select');
    const selectB = document.getElementById('teamB-select');
    if (!selectA || !selectB) return;

    selectA.innerHTML = '<option value="">Seleccionar equipo...</option>';
    selectB.innerHTML = '<option value="">Seleccionar equipo...</option>';

    Object.keys(WORLD_CUP_DATA.groups).forEach(group => {
        const teams = WORLD_CUP_DATA.groups[group];
        const ogA = document.createElement('optgroup');
        ogA.label = `── Grupo ${group} ──`;
        const ogB = document.createElement('optgroup');
        ogB.label = `── Grupo ${group} ──`;

        teams.forEach(team => {
            const flag = WORLD_CUP_DATA.teams[team]?.flag || '🏳️';
            const optA = new Option(`${flag} ${team}`, team);
            const optB = new Option(`${flag} ${team}`, team);
            ogA.appendChild(optA);
            ogB.appendChild(optB);
        });
        selectA.appendChild(ogA);
        selectB.appendChild(ogB);
    });

    // Preseleccionar partido interesante
    const firstTeam = Object.values(WORLD_CUP_DATA.groups.J || {})[0] || 'Argentina';
    const secondTeam = Object.values(WORLD_CUP_DATA.groups.I || {})[0] || 'Francia';
    selectA.value = firstTeam;
    selectB.value = secondTeam;
    updateTeamDisplay('A');
    updateTeamDisplay('B');
}

function setupTeamSelectorListeners() {
    document.getElementById('teamA-select')?.addEventListener('change', () => updateTeamDisplay('A'));
    document.getElementById('teamB-select')?.addEventListener('change', () => updateTeamDisplay('B'));
}

function updateTeamDisplay(side) {
    const select  = document.getElementById(`team${side}-select`);
    const teamName = select?.value;
    const data    = WORLD_CUP_DATA.teams[teamName];

    const flag = document.getElementById(`flag${side}`);
    const name = document.getElementById(`name${side}`);
    const rank = document.getElementById(`rank${side}`);
    if (!flag) return;

    if (data) {
        flag.innerHTML = data.flagHtml;
        name.textContent = teamName;
        const hostBadge = data.hostCountry ? ' 🏠' : '';
        rank.innerHTML = `FIFA #${data.fifaRanking} • ELO ${data.eloRating}${hostBadge}`;
    } else {
        flag.textContent = '🏳️';
        name.textContent = '—';
        rank.innerHTML = '';
    }
}

// ============================================================
// PREDICCIÓN DE PARTIDO
// ============================================================
async function runPrediction() {
    const teamA = document.getElementById('teamA-select').value;
    const teamB = document.getElementById('teamB-select').value;
    if (!teamA || !teamB) { showAlert('Selecciona dos equipos'); return; }
    if (teamA === teamB) { showAlert('Selecciona equipos diferentes'); return; }

    const btn = document.getElementById('predictBtn');
    const orig = btn.innerHTML;
    btn.innerHTML = '<span class="spinner"></span> Calculando...';
    btn.disabled = true;

    // Pequeño delay para permitir al UI actualizarse
    await delay(50);

    try {
        const result     = engine.predictMatch(teamA, teamB);
        if (result.error) throw new Error(result.error);
        const comparison = engine.compareTeams(teamA, teamB);
        displayPrediction(result, comparison);
    } catch (err) {
        console.error(err);
        showAlert('Error en la predicción: ' + err.message);
    } finally {
        btn.innerHTML = orig;
        btn.disabled = false;
    }
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function showAlert(msg) { alert(msg); }

// ============================================================
// MOSTRAR RESULTADOS DE PREDICCIÓN
// ============================================================
function displayPrediction(result, comparison) {
    const container = document.getElementById('predictionResults');
    if (!container) return;
    container.classList.add('visible');

    const dataA = WORLD_CUP_DATA.teams[result.teamA];
    const dataB = WORLD_CUP_DATA.teams[result.teamB];

    // ---- TARJETAS DE EQUIPO AMPLIADAS ----
    function buildTeamCard(teamName, data, side) {
        if (!data) return '';
        const f = data.recentForm;
        const total = f.wins + f.draws + f.losses;
        const pts = f.wins * 3 + f.draws;
        const formPct = total > 0 ? Math.round(pts / (total * 3) * 100) : 50;
        const goalsAvg = data.teamStats ? data.teamStats.avgGoalsScored.toFixed(2) : '—';
        const concAvg  = data.teamStats ? data.teamStats.avgGoalsConceded.toFixed(2) : '—';
        const titles   = data.worldCupTitles > 0
            ? `<span style="color:#f59e0b">${'⭐'.repeat(Math.min(data.worldCupTitles,5))}</span> ${data.worldCupTitles} título${data.worldCupTitles>1?'s':''}`
            : '<span style="color:var(--text-muted)">Sin títulos</span>';
        const hostBadge = data.hostCountry ? '<span class="host-badge">🏠 Local</span>' : '';
        return `
            <div class="team-detail-card ${side === 'A' ? 'card-left' : 'card-right'}">
                <div class="tdc-flag">${data.flagHtml}</div>
                <div class="tdc-name">${teamName} ${hostBadge}</div>
                <div class="tdc-conf">${data.confederation} • FIFA #${data.fifaRanking}</div>
                <div class="tdc-grid">
                    <div class="tdc-item"><span class="tdc-label">📊 ELO</span><span class="tdc-val">${data.eloRating}</span></div>
                    <div class="tdc-item"><span class="tdc-label">🏆 Mejor WC</span><span class="tdc-val" style="font-size:0.72rem">${data.worldCupBest}</span></div>
                    <div class="tdc-item"><span class="tdc-label">🏅 Títulos</span><span class="tdc-val">${titles}</span></div>
                    <div class="tdc-item"><span class="tdc-label">📅 Mundiales</span><span class="tdc-val">${data.worldCupAppearances}</span></div>
                    <div class="tdc-item"><span class="tdc-label">⚽ Goles/PJ</span><span class="tdc-val">${goalsAvg}</span></div>
                    <div class="tdc-item"><span class="tdc-label">🛱️ Conc./PJ</span><span class="tdc-val">${concAvg}</span></div>
                    <div class="tdc-item tdc-wide"><span class="tdc-label">📊 Forma (${total} PJ)</span>
                        <span class="tdc-val form-record">
                            <span class="form-w">V${f.wins}</span>
                            <span class="form-d">E${f.draws}</span>
                            <span class="form-l">D${f.losses}</span>
                            <span class="form-pct">${formPct}%</span>
                        </span>
                    </div>
                    <div class="tdc-item tdc-wide"><span class="tdc-label">📋 Entrenador</span><span class="tdc-val">${data.coach}</span></div>
                    <div class="tdc-item tdc-wide"><span class="tdc-label">💰 Valor plantilla</span><span class="tdc-val">${data.squadValue * 10}M € • Índice: ${side === 'A' ? result.strengthA : result.strengthB}/99</span></div>
                </div>
            </div>
        `;
    }

    // Insertar tarjetas en probBars section
    const probBarsEl = document.getElementById('probBars');
    probBarsEl.innerHTML = `
        <div class="team-cards-row">
            ${buildTeamCard(result.teamA, dataA, 'A')}
            <div class="team-cards-center">
                <div class="tc-vs">VS</div>
                <div class="tc-prob-bars">
                    <div class="prob-bar-item">
                        <div class="prob-label">${dataA.flagHtml} Victoria <strong>${result.teamA}</strong></div>
                        <div class="prob-value win-a">${result.winA}%</div>
                        <div class="prob-bar-visual"><div class="prob-bar-fill fill-win" style="width:${result.winA}%"></div></div>
                    </div>
                    <div class="prob-bar-item">
                        <div class="prob-label">🤝 Empate</div>
                        <div class="prob-value draw-val">${result.draw}%</div>
                        <div class="prob-bar-visual"><div class="prob-bar-fill fill-draw" style="width:${result.draw}%"></div></div>
                    </div>
                    <div class="prob-bar-item">
                        <div class="prob-label">${dataB.flagHtml} Victoria <strong>${result.teamB}</strong></div>
                        <div class="prob-value win-b">${result.winB}%</div>
                        <div class="prob-bar-visual"><div class="prob-bar-fill fill-loss" style="width:${result.winB}%"></div></div>
                    </div>
                </div>
            </div>
            ${buildTeamCard(result.teamB, dataB, 'B')}
        </div>
    `;

    // Marcador más probable + penales
    let penHtml = '';
    if (result.penaltyInfo) {
        penHtml = `
            <div class="penalty-info-box">
                ⚡ En caso de empate → Penales<br>
                <strong>${result.penaltyInfo.probWinA}%</strong> ${result.teamA}
                vs
                <strong>${result.penaltyInfo.probWinB}%</strong> ${result.teamB}
                — Favorito: <em>${result.penaltyInfo.expectedWinner}</em>
            </div>
        `;
    }

    // H2H Historial
    const h2hA = dataA.h2h?.[result.teamB];
    const h2hB = dataB.h2h?.[result.teamA];
    const h2hText = h2hA || h2hB;
    let h2hHtml = '';
    if (h2hText) {
        h2hHtml = `
            <div style="background:var(--bg-glass);padding:1.2rem;border-radius:12px;margin-bottom:1.5rem;border-left:4px solid var(--accent-gold);font-size:0.95rem;text-align:left">
                <div style="color:var(--accent-gold);margin-bottom:0.5rem;font-weight:600">📜 Historial (H2H)</div>
                <div style="color:var(--text-secondary);line-height:1.4">${h2hText}</div>
            </div>
        `;
    }

    document.getElementById('likelyScoreContainer').innerHTML = `
        ${h2hHtml}
        <div class="likely-score-label">Marcador más probable</div>
        <div class="likely-score-value">${result.mostLikelyScore}</div>
        <div class="likely-score-prob">Probabilidad: ${result.mostLikelyProb}% · Total goles esperados: ${result.expectedGoals}</div>
        ${penHtml}
    `;

    // Stats
    document.getElementById('statsGrid').innerHTML = `
        <div class="stat-card"><div class="stat-icon">⚽</div><div class="stat-label">λ Goles ${result.teamA}</div><div class="stat-value">${result.lambdaA}</div></div>
        <div class="stat-card"><div class="stat-icon">⚽</div><div class="stat-label">λ Goles ${result.teamB}</div><div class="stat-value">${result.lambdaB}</div></div>
        <div class="stat-card"><div class="stat-icon">📈</div><div class="stat-label">Over 2.5 goles</div><div class="stat-value">${result.over25}%</div></div>
        <div class="stat-card"><div class="stat-icon">🎯</div><div class="stat-label">Ambos Anotan</div><div class="stat-value">${result.btts}%</div></div>
        <div class="stat-card"><div class="stat-icon">💪</div><div class="stat-label">Índice ${result.teamA}</div><div class="stat-value">${result.strengthA}<small>/99</small></div></div>
        <div class="stat-card"><div class="stat-icon">💪</div><div class="stat-label">Índice ${result.teamB}</div><div class="stat-value">${result.strengthB}<small>/99</small></div></div>
    `;

    // Top 5 marcadores
    if (result.topScores?.length) {
        const maxP = parseFloat(result.topScores[0].probability);
        document.getElementById('topScoresContainer').innerHTML = result.topScores.map((s, i) => `
            <div class="score-row">
                <div class="score-rank ${i === 0 ? 'rank-1' : ''}">${i + 1}</div>
                <div class="score-value-text">${s.score}</div>
                <div class="score-prob-bar">
                    <div class="score-prob-fill" style="width:${(parseFloat(s.probability)/maxP)*100}%"></div>
                </div>
                <div class="score-prob-text">${s.probability}%</div>
            </div>
        `).join('');
    }

    // Comparación detallada
    const comp = comparison.comparison;
    const metrics = [
        { key: 'fifaRanking',      label: 'Ranking FIFA',       invert: true,  fmt: v => `#${v}` },
        { key: 'eloRating',        label: 'Rating ELO',         invert: false, fmt: v => v },
        { key: 'worldCupTitles',   label: '🏆 Títulos WC',      invert: false, fmt: v => v },
        { key: 'squadValue',       label: '💰 Valor Plantilla',  invert: false, fmt: v => `${v * 10}M` },
        { key: 'avgGoalsScored',   label: '⚽ Goles/partido',    invert: false, fmt: v => v.toFixed ? v.toFixed(2) : v },
        { key: 'avgPenaltyRating', label: '🎯 Rating Penales',   invert: false, fmt: v => v.toFixed ? v.toFixed(1) : v },
        { key: 'strength',         label: '📊 Fuerza Compuesta', invert: false, fmt: v => `${v}/99` }
    ];

    document.getElementById('comparisonGrid').innerHTML = metrics.map(m => {
        const c = comp[m.key];
        if (!c) return '';
        const numA = parseFloat(c.a) || 0;
        const numB = parseFloat(c.b) || 0;
        const total = numA + numB;
        let pA = total > 0 ? (numA / total) * 100 : 50;
        let pB = total > 0 ? (numB / total) * 100 : 50;
        if (m.invert) { [pA, pB] = [pB, pA]; }
        const winA = c.winner === result.teamA;
        return `
            <div class="comparison-row">
                <div class="comp-value left ${winA ? 'winner' : ''}">${m.fmt(c.a)}</div>
                <div class="comp-bar-container">
                    <div class="comp-bar-left" style="width:${pA}%"></div>
                    <div class="comp-bar-right" style="width:${pB}%"></div>
                    <div class="comp-bar-label">${m.label}</div>
                </div>
                <div class="comp-value right ${!winA ? 'winner' : ''}">${m.fmt(c.b)}</div>
            </div>
        `;
    }).join('');

    // Convocatoria completa organizada por posición
    renderFullSquads(result.teamA, result.teamB);

    container.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ============================================================
// CONVOCATORIA COMPLETA POR POSICIÓN
// ============================================================
function renderFullSquads(teamAName, teamBName) {
    const grid = document.getElementById('playersGrid');
    if (!grid) return;

    grid.innerHTML = [teamAName, teamBName].map(tName => {
        const team = WORLD_CUP_DATA.teams[tName];
        if (!team) return '';

        const positions = { POR: [], DEF: [], MED: [], DEL: [] };
        (team.players || []).forEach(p => {
            if (positions[p.position]) positions[p.position].push(p);
        });

        const posIcons = { POR: '🧤', DEF: '🛡️', MED: '⚙️', DEL: '🎯' };
        const posNames = { POR: 'Porteros', DEF: 'Defensas', MED: 'Mediocampistas', DEL: 'Delanteros' };

        const playersHtml = Object.entries(positions).map(([pos, players]) => {
            if (!players.length) return '';
            const sorted = [...players].sort((a, b) => (b.penaltyRating || 0) - (a.penaltyRating || 0));
            return `
                <div class="squad-position-group">
                    <div class="squad-pos-header">${posIcons[pos]} ${posNames[pos]}</div>
                    ${sorted.map((p, i) => {
                        const isTop = i === 0;
                        const rating = p.penaltyRating || 50;
                        const ratingColor = rating >= 80 ? '#22c55e' : rating >= 65 ? '#f59e0b' : '#94a3b8';
                        return `
                            <div class="player-item ${isTop ? 'player-star' : ''}">
                                <span class="player-position pos-${pos}">${pos}</span>
                                <span class="player-name">${isTop ? '⭐ ' : ''}${p.name}</span>
                                <span class="player-stats">
                                    <span title="Goles">⚽${p.goals || 0}</span>
                                    <span title="Asistencias">🅰️${p.assists || 0}</span>
                                    <span title="Media Global" style="color:${ratingColor};font-weight:600">${rating}</span>
                                </span>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
        }).join('');

        const topScorer = [...(team.players || [])].sort((a, b) => (b.goals || 0) - (a.goals || 0))[0];
        const topAssister = [...(team.players || [])].sort((a, b) => (b.assists || 0) - (a.assists || 0))[0];

        return `
            <div class="players-team">
                <div class="players-team-header">
                    <span class="flag">${team.flagHtml}</span>
                    <span class="name">${tName}</span>
                    <span class="coach-label">DT: ${team.coach}</span>
                </div>
                <div class="team-quick-stats">
                    <span title="Goleador">🥇 Gol: ${topScorer?.name || '—'} (${topScorer?.goals || 0})</span>
                    <span title="Asistidor">🤝 Asist: ${topAssister?.name || '—'} (${topAssister?.assists || 0})</span>
                </div>
                <div class="squad-list">
                    ${playersHtml}
                </div>
            </div>
        `;
    }).join('');
}

// ============================================================
// RANKING DE FAVORITOS
// ============================================================
function renderFavorites() {
    const favs = engine.getFavorites();
    const grid = document.getElementById('favoritesGrid');
    if (!grid) return;

    grid.innerHTML = favs.map((t, i) => {
        const teamData = WORLD_CUP_DATA.teams[t.team];
        return `
        <div class="favorite-row" onclick="selectTeamForPrediction('${escapeAttr(t.team)}')">
            <div class="favorite-rank ${i < 3 ? 'top-3' : ''}">${i + 1}</div>
            <div class="favorite-flag">${teamData.flagHtml}</div>
            <div class="favorite-name">
                ${t.team}
                <span class="team-conf">${t.confederation} • FIFA #${t.fifaRanking}</span>
            </div>
            <div class="favorite-strength">
                ${t.strength}
                <div class="strength-bar">
                    <div class="strength-fill" style="width:${t.strength}%"></div>
                </div>
            </div>
            <div class="favorite-elo">${t.eloRating}</div>
            <div class="favorite-titles">${t.titles > 0 ? '⭐'.repeat(Math.min(t.titles, 5)) : '—'}</div>
        </div>
        `;
    }).join('');
}

function escapeAttr(s) { return s.replace(/'/g, "\\'"); }

window.selectTeamForPrediction = function (team) {
    document.getElementById('teamA-select').value = team;
    updateTeamDisplay('A');
    document.querySelector('[data-tab="predictor"]')?.click();
};

// ============================================================
// FASE DE GRUPOS
// ============================================================
function renderGroups() {
    const groups = Object.keys(WORLD_CUP_DATA.groups);
    const grid = document.getElementById('groupsGrid');
    if (!grid) return;

    const difficulty = engine.analyzeGroupDifficulty();

    grid.innerHTML = groups.map(g => {
        const sim  = engine.simulateGroup(g);
        const diff = difficulty[g];

        const diffClass = {
            'Grupo de la Muerte': 'diff-death',
            'Difícil': 'diff-hard',
            'Equilibrado': 'diff-medium',
            'Accesible': 'diff-easy'
        }[diff.difficulty] || 'diff-medium';

        const matchesHtml = (sim.matches || []).map(m => `
            <div class="group-match">
                <span class="gm-team">${WORLD_CUP_DATA.teams[m.teamA]?.flagHtml} ${m.teamA}</span>
                <span class="gm-score">${m.scoreA} - ${m.scoreB}</span>
                <span class="gm-team">${m.teamB} ${WORLD_CUP_DATA.teams[m.teamB]?.flagHtml}</span>
                <span class="gm-prob">${m.pred?.winA || 0}% - ${m.pred?.winB || 0}%</span>
            </div>
        `).join('');

        return `
            <div class="group-card">
                <div class="group-header">
                    <span class="group-name">Grupo ${g}</span>
                    <span class="group-difficulty ${diffClass}">${diff.difficulty} (${diff.avgStrength})</span>
                </div>
                <table class="group-table">
                    <thead>
                        <tr><th>Equipo</th><th>PJ</th><th>G</th><th>E</th><th>P</th><th>GF</th><th>GC</th><th>DG</th><th>Pts</th></tr>
                    </thead>
                    <tbody>
                        ${sim.standings.map((t, i) => {
                            const teamData = WORLD_CUP_DATA.teams[t.team];
                            return `
                            <tr class="${i < 2 ? 'qualified' : ''}">
                                <td>
                                    <div class="team-cell">
                                        <span class="flag">${teamData.flagHtml}</span>
                                        <span>${t.team}</span>
                                        ${i < 2 ? '<span class="qualified-badge">✓</span>' : ''}
                                    </div>
                                </td>
                                <td>${t.played}</td>
                                <td>${t.wins}</td>
                                <td>${t.draws}</td>
                                <td>${t.losses}</td>
                                <td>${t.goalsFor}</td>
                                <td>${t.goalsAgainst}</td>
                                <td>${t.goalDifference > 0 ? '+'+t.goalDifference : t.goalDifference}</td>
                                <td class="points-cell">${t.points}</td>
                            </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
                <div class="group-matches-preview">
                    <div class="matches-toggle" onclick="this.nextElementSibling.classList.toggle('open')">
                        📋 Ver partidos predichos ▾
                    </div>
                    <div class="matches-content">${matchesHtml}</div>
                </div>
            </div>
        `;
    }).join('');
}

// ============================================================
// SIMULACIÓN MONTE CARLO
// ============================================================
async function runSimulation() {
    const iters   = parseInt(document.getElementById('simIterations').value);
    const btn     = document.getElementById('simulateBtn');
    const progDiv = document.getElementById('simProgress');
    const resDiv  = document.getElementById('simResults');

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Simulando...';
    progDiv.classList.add('visible');
    resDiv.classList.remove('visible');

    const fill = document.getElementById('progressFill');
    const text = document.getElementById('progressText');
    
    text.textContent = 'Iniciando motor matemático...';
    fill.style.width = '0%';

    // Instanciar Web Worker
    const worker = new Worker('simulation.worker.js');

    worker.onmessage = function(e) {
        if (e.data.type === 'progress') {
            const { completed, total } = e.data;
            fill.style.width = `${Math.round((completed / total) * 100)}%`;
            text.textContent = `Simulando Universos... ${completed.toLocaleString()} / ${total.toLocaleString()}`;
        } else if (e.data.type === 'done') {
            const allResults = e.data.results;
            fill.style.width = '100%';
            text.textContent = `✓ ${iters.toLocaleString()} simulaciones completadas en Web Worker`;
            
            setTimeout(() => {
                displaySimulationResults(allResults);
                btn.disabled = false;
                btn.innerHTML = '<span>🎲</span> Ejecutar Simulación';
                setTimeout(() => progDiv.classList.remove('visible'), 2500);
            }, 400);
            
            worker.terminate();
        }
    };

    worker.onerror = function(err) {
        console.error("Worker error:", err);
        text.textContent = 'Error en el Worker.';
        btn.disabled = false;
        btn.innerHTML = '<span>🎲</span> Reintentar Simulación';
        worker.terminate();
    };

    worker.postMessage({ data: WORLD_CUP_DATA, iterations: iters });
}

function displaySimulationResults(results) {
    const tbody = document.getElementById('simTableBody');
    if (!tbody) return;

    const sorted = [...results].sort((a, b) => b.champion - a.champion);
    const maxChamp = sorted[0]?.champion || 1;

    tbody.innerHTML = sorted.map((t, i) => {
        const champClass = t.champion >= 8 ? 'high' : t.champion >= 3 ? 'medium' : 'low';
        const teamData = WORLD_CUP_DATA.teams[t.team];
        const champBarWidth = Math.round((t.champion / maxChamp) * 100);
        return `
            <tr class="${i < 3 ? 'sim-top3' : ''}">
                <td class="sim-rank-cell">${i < 3 ? ['\ud83e\udd47','\ud83e\udd48','\ud83e\udd49'][i] : i+1}</td>
                <td class="sim-flag-cell" title="${t.team}">${teamData?.flagHtml || t.flag}</td>
                <td class="sim-team-cell">
                    <strong>${t.team}</strong>
                    <small style="display:block;color:var(--text-muted);font-size:0.7rem">${teamData?.confederation || ''} • ELO ${teamData?.eloRating || ''}</small>
                </td>
                <td>
                    <div style="display:flex;align-items:center;gap:0.5rem">
                        <span class="sim-champ-pct ${champClass}">${t.champion}%</span>
                        <div style="flex:1;height:4px;background:var(--bg-glass);border-radius:2px;min-width:40px">
                            <div style="height:100%;border-radius:2px;background:linear-gradient(90deg,var(--accent-gold),var(--accent-primary-light));width:${champBarWidth}%"></div>
                        </div>
                    </div>
                </td>
                <td>${t.final}%</td>
                <td>${t.semiFinals}%</td>
                <td>${t.quarterFinals}%</td>
                <td>${t.roundOf16}%</td>
                <td>${t.roundOf32}%</td>
                <td style="color:var(--accent-secondary);font-weight:700">${t.avgPoints}</td>
            </tr>
        `;
    }).join('');

    document.getElementById('simResults').classList.add('visible');

    // Render Deterministic Probability Funnel
    const bracketDiv = document.getElementById('simBracket');
    if (bracketDiv) {
        bracketDiv.style.display = 'block';
        
        const r16Teams = [...results].sort((a,b) => b.roundOf16 - a.roundOf16).slice(0, 16);
        const qfTeams = [...results].sort((a,b) => b.quarterFinals - a.quarterFinals).slice(0, 8);
        const sfTeams = [...results].sort((a,b) => b.semiFinals - a.semiFinals).slice(0, 4);
        const fTeams = [...results].sort((a,b) => b.final - a.final).slice(0, 2);
        const champ = sorted[0];

        const getHtml = (t) => WORLD_CUP_DATA.teams[t]?.flagHtml || '🏳️';

        bracketDiv.innerHTML = `
            <h3 style="text-align:center;margin-bottom:0.5rem;color:var(--accent-primary-light)">Embudos de Probabilidad (Top Equipos por Fase)</h3>
            <p style="text-align:center;font-size:0.85rem;color:var(--text-muted);margin-bottom:1.5rem">Debido al sorteo dinámico de terceros lugares de la FIFA, las llaves no son fijas. Estos son los equipos con mayor % de llegar a cada fase.</p>
            
            <div style="display:flex;flex-direction:column;gap:15px;background:var(--bg-glass);padding:20px;border-radius:12px">
                
                <div style="text-align:center;background:rgba(255,215,0,0.1);padding:20px;border-radius:16px;box-shadow:inset 0 0 20px rgba(255,215,0,0.05), 0 4px 15px rgba(0,0,0,0.2)">
                    <div style="font-size:0.8rem;color:var(--accent-gold);letter-spacing:1px;margin-bottom:5px">🏆 CAMPEÓN MÁS PROBABLE</div>
                    <div style="font-size:1.8rem;text-shadow:0 0 10px rgba(255,215,0,0.5)">${getHtml(champ.team)} <b>${champ.team}</b></div>
                </div>

                <div style="display:flex;justify-content:center;gap:2rem;padding:10px;border-bottom:1px solid rgba(255,255,255,0.05)">
                    <div style="text-align:center"><div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:5px">FINALISTAS</div>
                    <div style="display:flex;gap:1.5rem;font-size:1.1rem">${fTeams.map(t=>`<div>${getHtml(t.team)} ${t.team}</div>`).join('')}</div></div>
                </div>

                <div style="display:flex;justify-content:center;gap:2rem;padding:10px;border-bottom:1px solid rgba(255,255,255,0.05)">
                    <div style="text-align:center"><div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:5px">SEMIFINALISTAS</div>
                    <div style="display:flex;gap:1.5rem;font-size:1rem;flex-wrap:wrap;justify-content:center">${sfTeams.map(t=>`<div>${getHtml(t.team)} ${t.team}</div>`).join('')}</div></div>
                </div>

                <div style="display:flex;justify-content:center;gap:2rem;padding:10px;border-bottom:1px solid rgba(255,255,255,0.05)">
                    <div style="text-align:center"><div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:5px">CUARTOS DE FINAL</div>
                    <div style="display:flex;gap:1.2rem;font-size:0.9rem;flex-wrap:wrap;justify-content:center;color:var(--text-secondary)">${qfTeams.map(t=>`<div>${getHtml(t.team)} ${t.team}</div>`).join('')}</div></div>
                </div>

                <div style="display:flex;justify-content:center;gap:2rem;padding:10px">
                    <div style="text-align:center"><div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:5px">OCTAVOS DE FINAL</div>
                    <div style="display:flex;gap:1rem;font-size:0.85rem;flex-wrap:wrap;justify-content:center;color:var(--text-muted)">${r16Teams.map(t=>`<div>${getHtml(t.team)} ${t.team}</div>`).join('')}</div></div>
                </div>

            </div>
        `;
    }
}
