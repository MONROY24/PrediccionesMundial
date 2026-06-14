// ============================================================
// APP.JS - CONTROLADOR PRINCIPAL v5.0 (Mundial 2026)
// Integra: PredictionEngine v5.0 + ResultsManager
// ============================================================

// ============================================================
// FLAG HELPER
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

// ============================================================
// GLOBALS
// ============================================================
let WORLD_CUP_DATA = null;
let engine = null;
let resultsManager = null;

// ── Estado de Análisis IA (Fase 8-9) ──
let _currentPredictionForAI = null;   // Predicción activa para enviar a Gemini
let _aiAnalysisCache = {};            // Cache de análisis por partido
let _aiAnalysisAbort = null;          // AbortController para cancelar peticiones

// ============================================================
// INICIALIZACIÓN
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // ── Paso 1: Cargar data.json base ──
        const response = await fetch('data.json');
        WORLD_CUP_DATA = await response.json();

        Object.keys(WORLD_CUP_DATA.teams).forEach(team => {
            WORLD_CUP_DATA.teams[team].flagHtml = getFlagHtml(WORLD_CUP_DATA.teams[team].flag);
        });

        // Banderas del Hero
        const heroFlagsEl = document.getElementById('heroFlags');
        if (heroFlagsEl) {
            const hosts = ['Estados Unidos', 'México', 'Canadá'];
            heroFlagsEl.innerHTML = hosts.map(h => {
                const team = WORLD_CUP_DATA.teams[h];
                return team ? `<div style="width:35px; height:auto; filter:drop-shadow(0 4px 6px rgba(0,0,0,0.4));">${team.flagHtml}</div>` : '';
            }).join('');
        }

        // ── Paso 2: Inicializar motor base ──
        engine = new PredictionEngine(WORLD_CUP_DATA);

        // ── Paso 3: Inicializar ResultsManager y restaurar calibración local ──
        resultsManager = new ResultsManager();
        if (resultsManager.getResultCount() > 0) {
            const restored = resultsManager.restoreEngineCalibration(engine);
            if (restored) {
                console.log(`[App] Calibración local restaurada: ${resultsManager.getResultCount()} partidos previos`);
            }
        }

        // ── Paso 4 (FASE 2-4): Cargar datos en vivo en background (no bloquea UI) ──
        resultsManager.loadLiveData(WORLD_CUP_DATA).then(liveResult => {
            if (liveResult.updated > 0) {
                // Reconstruir engine con datos frescos
                engine = new PredictionEngine(WORLD_CUP_DATA);
                resultsManager.restoreEngineCalibration(engine);
                engine._strengthCache = {};
                // Actualizar renders que dependen de ELO
                renderFavorites();
                renderGroups();
                console.log(`[App v6] ELO en vivo: ${liveResult.updated} equipos actualizados desde ${liveResult.source}`);
                // Mostrar badge de datos frescos
                showLiveDataBadge(liveResult.updated);
            }
        }).catch(() => { /* Fallo silencioso, data.json ya está cargado */ });

        // ── Paso 5 (FASE 6): Cargar estado compartido del backend ──
        resultsManager.loadSharedState(engine).then(sharedResult => {
            if (sharedResult.applied) {
                console.log(`[App v6] Estado compartido aplicado: ${sharedResult.matchesProcessed} partidos globales`);
                updateCalibrationDisplay();
            }
        }).catch(() => { /* Fallo silencioso */ });

        initTabs();
        populateTeamSelectors();
        handleUrlParams();

        renderFavorites();
        renderGroups();
        setupTeamSelectorListeners();
        setupButtons();

        // Módulos nuevos v5
        populateResultsSelectors();
        setupResultsTab();
        renderResultsList();
        renderPerformance();
        updateCalibrationDisplay();

    } catch (error) {
        console.error('Error cargando los datos:', error);
        document.body.innerHTML = `<h2 style="color:white;text-align:center;margin-top:50px">⚠️ Error crítico cargando data.json. Asegúrate de estar ejecutando la web a través de un servidor (ej. Live Server o Vercel).</h2>`;
    }
});

// Muestra badge temporal de datos frescos en el hero
function showLiveDataBadge(count) {
    const badge = document.getElementById('liveDataBadge');
    if (badge) {
        badge.textContent = `🔴 EN VIVO • ${count} equipos actualizados`;
        badge.style.opacity = '1';
        setTimeout(() => { badge.style.opacity = '0'; }, 8000);
    }
}

// ============================================================
// URL PARAMS
// ============================================================
function handleUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const teamA = params.get('a');
    const teamB = params.get('b');
    if (teamA && teamB && WORLD_CUP_DATA.teams[teamA] && WORLD_CUP_DATA.teams[teamB]) {
        document.getElementById('teamA-select').value = teamA;
        document.getElementById('teamB-select').value = teamB;
        updateTeamDisplay('A');
        updateTeamDisplay('B');
        setTimeout(() => runPrediction(), 400);
    }
}

// ============================================================
// BOTONES
// ============================================================
function setupButtons() {
    document.getElementById('predictBtn')?.addEventListener('click', runPrediction);
    document.getElementById('simulateBtn')?.addEventListener('click', runSimulation);

    // Selector de modelo
    const singleModelSelect = document.getElementById('singleMatchModel');
    if (singleModelSelect) {
        singleModelSelect.addEventListener('change', () => {
            const descEl = document.getElementById('singleMatchModelDesc');
            const val = singleModelSelect.value;
            const descs = {
                standard:  'v5.0 calibrado: λ exponencial + ELO histórico ponderado (65%). Garantiza coherencia entre probabilidad de victoria y marcador predicho.',
                pure_elo:  'Apaga las rachas y el dinero. 100% matemático y frío, basado estrictamente en el Ranking ELO histórico. Ideal para la teoría pura.',
                momentum:  'Premia la racha victoriosa con impulso exponencial. Perfecto para detectar "Caballos Negros" en plena racha.',
                economic:  'Ignora historia y táctica. Asume que la calidad de plantilla (valor de mercado en €) aplasta la táctica rival.',
                defensive: 'El enfoque de los Mundiales cerrados: disminuye las probabilidades de goleo y premia los esquemas defensivos.'
            };
            if (descEl) descEl.innerHTML = descs[val] || '';
            if (document.getElementById('predictionResults')?.classList.contains('visible')) {
                runPrediction();
            }
        });
    }

    // Share
    document.getElementById('shareBtn')?.addEventListener('click', () => {
        const tA = document.getElementById('teamA-select').value;
        const tB = document.getElementById('teamB-select').value;
        if (!tA || !tB) return alert('Selecciona dos equipos primero.');
        const url = new URL(window.location.href);
        url.searchParams.set('a', tA);
        url.searchParams.set('b', tB);
        navigator.clipboard.writeText(url.toString()).then(() => {
            const btn = document.getElementById('shareBtn');
            btn.textContent = '✅';
            setTimeout(() => btn.textContent = '🔗', 2000);
        });
    });

    // Export prediction
    document.getElementById('exportBtn')?.addEventListener('click', async () => {
        const resultsEl = document.getElementById('predictionResults');
        if (!resultsEl.classList.contains('visible')) return alert('Ejecuta una predicción primero.');
        const btn = document.getElementById('exportBtn');
        const orig = btn.innerHTML;
        btn.innerHTML = '⏳';
        try {
            const canvas = await html2canvas(resultsEl, { backgroundColor: '#0f0f1a', scale: 2, logging: false, useCORS: true });
            const link = document.createElement('a');
            const tA = document.getElementById('teamA-select').value;
            const tB = document.getElementById('teamB-select').value;
            link.download = `Prediccion_${tA}_vs_${tB}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
            btn.innerHTML = '✅';
        } catch (err) {
            console.error(err);
            alert('Error al exportar la imagen.');
            btn.innerHTML = '❌';
        }
        setTimeout(() => btn.innerHTML = orig, 2000);
    });

    // Export global
    document.getElementById('globalExportBtn')?.addEventListener('click', async () => {
        const appContainer = document.querySelector('.app-container');
        const btn = document.getElementById('globalExportBtn');
        const orig = btn.innerHTML;
        btn.innerHTML = '⏳ Exportando...';
        try {
            const canvas = await html2canvas(appContainer, { backgroundColor: '#0a0e1a', scale: 2, logging: false, useCORS: true });
            const link = document.createElement('a');
            link.download = `Predictor_Mundial_MR24_${Date.now()}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
            btn.innerHTML = '✅ Exportado';
        } catch (err) {
            console.error(err);
            alert('Error al exportar.');
            btn.innerHTML = '❌ Error';
        }
        setTimeout(() => btn.innerHTML = orig, 3000);
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

            // Actualizar métricas al entrar al tab de desempeño
            if (tab.dataset.tab === 'performance') {
                renderPerformance();
                updateCalibrationDisplay();
            }
        });
    });
}

// ============================================================
// SELECTORES DE EQUIPOS
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
            ogA.appendChild(new Option(`${flag} ${team}`, team));
            ogB.appendChild(new Option(`${flag} ${team}`, team));
        });
        selectA.appendChild(ogA);
        selectB.appendChild(ogB);
    });

    const firstTeam  = Object.values(WORLD_CUP_DATA.groups.J || {})[0] || 'Argentina';
    const secondTeam = Object.values(WORLD_CUP_DATA.groups.I || {})[0] || 'Francia';
    selectA.value = firstTeam;
    selectB.value = secondTeam;

    if (window.TomSelect) {
        const tsConfig = {
            create: false,
            plugins: ['dropdown_input'],
            render: {
                option: (data, escape) => {
                    const team = WORLD_CUP_DATA.teams[data.value];
                    const flagHtml = team ? team.flagHtml : '🏳️';
                    const textName = escape(data.text).replace(emojiRegex, '').trim();
                    return `<div><span style="display:inline-block;width:20px;text-align:center;margin-right:8px;vertical-align:middle;">${flagHtml}</span><span style="vertical-align:middle;">${textName}</span></div>`;
                },
                item: (data, escape) => {
                    const team = WORLD_CUP_DATA.teams[data.value];
                    const flagHtml = team ? team.flagHtml : '🏳️';
                    const textName = escape(data.text).replace(emojiRegex, '').trim();
                    return `<div><span style="display:inline-block;width:20px;text-align:center;margin-right:8px;vertical-align:middle;">${flagHtml}</span><span style="vertical-align:middle;">${textName}</span></div>`;
                }
            }
        };
        new TomSelect(selectA, tsConfig);
        new TomSelect(selectB, tsConfig);
        const simIters = document.getElementById('simIterations');
        if (simIters) new TomSelect(simIters, { create: false, controlInput: null });
    }

    updateTeamDisplay('A');
    updateTeamDisplay('B');
}

// Regex para strips de emojis en TomSelect
const emojiRegex = /^(?:[\u2700-\u27bf]|(?:\ud83c[\udde6-\uddff]){2}|[\ud800-\udbff][\udc00-\udfff]|[\u0023-\u0039]\ufe0f?\u20e3|\u3299|\u3297|\u303d|\u3030|\u24c2|\ud83c[\udd70-\udd71]|\ud83c[\udd7e-\udd7f]|\ud83c\udd8e|\ud83c[\udd91-\udd9a]|\ud83c[\udde6-\uddff]|\ud83c[\ude01-\ude02]|\ud83c\ude1a|\ud83c\ude2f|\ud83c[\ude32-\ude3a]|\ud83c[\ude50-\ude51]|\u203c|\u2049|[\u25aa-\u25ab]|\u25b6|\u25c0|[\u25fb-\u25fe]|\u00a9|\u00ae|\u2122|\u2139|\ud83c\udc04|[\u2600-\u26FF]|\u2b05|\u2b06|\u2b07|\u2b1b|\u2b1c|\u2b50|\u2b55|\u231a|\u231b|\u2328|\u23cf|[\u23e9-\u23f3]|[\u23f8-\u23fa]|\ud83c\udccf|\u2934|\u2935|[\u2190-\u21ff])\s*/g;

function setupTeamSelectorListeners() {
    document.getElementById('teamA-select')?.addEventListener('change', () => updateTeamDisplay('A'));
    document.getElementById('teamB-select')?.addEventListener('change', () => updateTeamDisplay('B'));
}

function updateTeamDisplay(side) {
    const select   = document.getElementById(`team${side}-select`);
    const teamName = select?.value;
    const data     = WORLD_CUP_DATA.teams[teamName];

    const flag = document.getElementById(`flag${side}`);
    const name = document.getElementById(`name${side}`);
    const rank = document.getElementById(`rank${side}`);
    if (!flag) return;

    if (data) {
        flag.innerHTML  = data.flagHtml;
        name.textContent = teamName;
        const hostBadge = data.hostCountry ? ' 🏠' : '';
        rank.innerHTML  = `FIFA #${data.fifaRanking} • ELO ${data.eloRating}${hostBadge}`;
    } else {
        flag.textContent = '🏳️';
        name.textContent = '—';
        rank.innerHTML   = '';
    }
}

// ============================================================
// PREDICCIÓN DE PARTIDO
// ============================================================
async function runPrediction() {
    const teamA = document.getElementById('teamA-select').value;
    const teamB = document.getElementById('teamB-select').value;
    if (!teamA || !teamB) { showAlert('Selecciona dos equipos'); return; }
    if (teamA === teamB)  { showAlert('Selecciona equipos diferentes'); return; }

    const btn  = document.getElementById('predictBtn');
    const orig = btn.innerHTML;
    btn.innerHTML = '<span class="spinner"></span> Calculando...';
    btn.disabled  = true;

    await delay(50);

    try {
        const currentModel = document.getElementById('singleMatchModel')?.value || 'standard';
        engine.modelType   = currentModel;

        // ── FASE 7: Aplicar factores contextuales si están configurados ──
        const contextFactors = getContextualFactors();
        applyContextualEloAdjustment(teamA, teamB, contextFactors);

        const result = engine.predictMatch(teamA, teamB);

        // Revertir ajustes contextuales (no persistir cambios en los datos base)
        revertContextualEloAdjustment(teamA, teamB);

        if (result.error) throw new Error(result.error);

        // Guardar predicción en ResultsManager para evaluación posterior
        if (resultsManager) {
            resultsManager.savePrediction(teamA, teamB, result);
        }

        // Guardar predicción actual para el análisis IA
        _currentPredictionForAI = { teamA, teamB, result, contextFactors };

        const comparison = engine.compareTeams(teamA, teamB);
        displayPrediction(result, comparison);

        // ── FASE 8-9: Lanzar análisis Gemini automáticamente ──
        triggerAIAnalysis(teamA, teamB, result, contextFactors);

    } catch (err) {
        console.error(err);
        showAlert('Error en la predicción: ' + err.message);
    } finally {
        btn.innerHTML = orig;
        btn.disabled  = false;
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

    function buildTeamCard(teamName, data, side) {
        if (!data) return '';
        const f = data.recentForm;
        const total = f.wins + f.draws + f.losses;
        const pts = f.wins * 3 + f.draws;
        const formPct = total > 0 ? Math.round(pts / (total * 3) * 100) : 50;
        const goalsAvg = data.teamStats ? data.teamStats.avgGoalsScored.toFixed(2) : '—';
        const concAvg  = data.teamStats ? data.teamStats.avgGoalsConceded.toFixed(2) : '—';
        const titles   = data.worldCupTitles > 0
            ? `<span style="color:#f59e0b">${'⭐'.repeat(Math.min(data.worldCupTitles, 5))}</span> ${data.worldCupTitles} título${data.worldCupTitles > 1 ? 's' : ''}`
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
                    <div class="tdc-item"><span class="tdc-label">🛡️ Conc./PJ</span><span class="tdc-val">${concAvg}</span></div>
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

    document.getElementById('probBars').innerHTML = `
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

    // Penales
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

    // H2H
    const h2hText = dataA.h2h?.[result.teamB] || dataB.h2h?.[result.teamA];
    const h2hHtml = h2hText ? `
        <div style="background:var(--bg-glass);padding:1.2rem;border-radius:12px;margin-bottom:1.5rem;border-left:4px solid var(--accent-gold);font-size:0.95rem;text-align:left">
            <div style="color:var(--accent-gold);margin-bottom:0.5rem;font-weight:600">📜 Historial (H2H)</div>
            <div style="color:var(--text-secondary);line-height:1.4">${h2hText}</div>
        </div>
    ` : '';

    // Apuestas
    let betHtml = '';
    if (result.bettingRecommendations?.length > 0) {
        const recList = result.bettingRecommendations.map(r => `
            <div style="background: rgba(16,185,129,0.08); border-left: 3px solid var(--accent-emerald); padding: 0.8rem 1rem; border-radius: 8px; display: flex; align-items: center; gap: 0.8rem; flex: 1; min-width: 240px; box-shadow: inset 0 0 10px rgba(0,0,0,0.2);">
                <div style="font-size: 1.4rem; width: 30px; text-align: center;">${r.icon}</div>
                <div>
                    <div style="color: var(--text-muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 0.2rem; font-weight: 600;">${r.market}</div>
                    <div style="color: #ffffff; font-weight: 500; font-size: 0.95rem;">${r.tip}</div>
                </div>
            </div>
        `).join('');
        betHtml = `
            <div style="margin-top: 2rem; background: var(--bg-glass); border: 1px solid rgba(16,185,129,0.2); padding: 1.5rem; border-radius: 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.3);">
                <div style="display: flex; align-items: center; gap: 0.8rem; margin-bottom: 1.2rem; padding-bottom: 0.8rem; border-bottom: 1px solid rgba(255,255,255,0.05);">
                    <span style="font-size: 1.5rem;">🎯</span>
                    <h3 style="margin: 0; color: var(--accent-emerald); font-weight: 800; font-size: 1.05rem; text-transform: uppercase; letter-spacing: 1.5px;">Inteligencia Analítica de Apuestas</h3>
                </div>
                <div style="display: flex; flex-wrap: wrap; gap: 1rem;">${recList}</div>
            </div>
        `;
    }

    document.getElementById('likelyScoreContainer').innerHTML = `
        ${h2hHtml}
        <div class="likely-score-label">Marcador más probable</div>
        <div class="likely-score-value">${result.mostLikelyScore}</div>
        <div class="likely-score-prob">Probabilidad: ${result.mostLikelyProb}% · Total goles esperados: ${result.expectedGoals}</div>
        ${penHtml}
        ${betHtml}
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
                    <div class="score-prob-fill" style="width:${(parseFloat(s.probability) / maxP) * 100}%"></div>
                </div>
                <div class="score-prob-text">${s.probability}%</div>
            </div>
        `).join('');
    }

    // Comparación
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

    renderFullSquads(result.teamA, result.teamB);
    container.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ============================================================
// CONVOCATORIA
// ============================================================
function renderFullSquads(teamAName, teamBName) {
    const grid = document.getElementById('playersGrid');
    if (!grid) return;

    grid.innerHTML = [teamAName, teamBName].map(tName => {
        const team = WORLD_CUP_DATA.teams[tName];
        if (!team) return '';

        const positions = { POR: [], DEF: [], MED: [], DEL: [] };
        (team.players || []).forEach(p => { if (positions[p.position]) positions[p.position].push(p); });

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
                                    <span title="Rating" style="color:${ratingColor};font-weight:600">${rating}</span>
                                </span>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
        }).join('');

        const topScorer   = [...(team.players || [])].sort((a, b) => (b.goals   || 0) - (a.goals   || 0))[0];
        const topAssister = [...(team.players || [])].sort((a, b) => (b.assists || 0) - (a.assists || 0))[0];

        return `
            <div class="players-team">
                <div class="players-team-header">
                    <span class="flag">${team.flagHtml}</span>
                    <span class="name">${tName}</span>
                    <span class="coach-label">DT: ${team.coach}</span>
                </div>
                <div class="team-quick-stats">
                    <span>🥇 Gol: ${topScorer?.name || '—'} (${topScorer?.goals || 0})</span>
                    <span>🤝 Asist: ${topAssister?.name || '—'} (${topAssister?.assists || 0})</span>
                </div>
                <div class="squad-list">${playersHtml}</div>
            </div>
        `;
    }).join('');
}

// ============================================================
// FAVORITOS
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
// GRUPOS
// ============================================================
function renderGroups() {
    const groups = Object.keys(WORLD_CUP_DATA.groups);
    const grid   = document.getElementById('groupsGrid');
    if (!grid) return;

    const difficulty = engine.analyzeGroupDifficulty();

    grid.innerHTML = groups.map(g => {
        const sim  = engine.simulateGroup(g);
        const diff = difficulty[g];

        const diffClass = {
            'Grupo de la Muerte': 'diff-death',
            'Difícil':            'diff-hard',
            'Equilibrado':        'diff-medium',
            'Accesible':          'diff-easy'
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
                    <thead><tr><th>Equipo</th><th>PJ</th><th>G</th><th>E</th><th>P</th><th>GF</th><th>GC</th><th>DG</th><th>Pts</th></tr></thead>
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
                                <td>${t.goalDifference > 0 ? '+' + t.goalDifference : t.goalDifference}</td>
                                <td class="points-cell">${t.points}</td>
                            </tr>`;
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
    const iters     = parseInt(document.getElementById('simIterations').value);
    const modelType = document.getElementById('simModel').value;
    const btn       = document.getElementById('simulateBtn');
    const progDiv   = document.getElementById('simProgress');
    const resDiv    = document.getElementById('simResults');

    btn.disabled  = true;
    btn.innerHTML = '<span class="spinner"></span> Simulando...';
    progDiv.classList.add('visible');
    resDiv.classList.remove('visible');

    const fill = document.getElementById('progressFill');
    const text = document.getElementById('progressText');
    text.textContent = 'Iniciando motor matemático...';
    fill.style.width = '0%';

    const worker = new Worker('simulation.worker.js');

    worker.onmessage = function (e) {
        if (e.data.type === 'progress') {
            const { completed, total } = e.data;
            fill.style.width = `${Math.round((completed / total) * 100)}%`;
            text.textContent = `Simulando Universos... ${completed.toLocaleString()} / ${total.toLocaleString()}`;
        } else if (e.data.type === 'done') {
            fill.style.width = '100%';
            text.textContent = `✓ ${iters.toLocaleString()} simulaciones completadas`;
            setTimeout(() => {
                displaySimulationResults(e.data.results);
                btn.disabled  = false;
                btn.innerHTML = '<span>🎲</span> Ejecutar Simulación';
                setTimeout(() => progDiv.classList.remove('visible'), 2500);
            }, 400);
            worker.terminate();
        }
    };

    worker.onerror = function (err) {
        console.error('Worker error:', err);
        text.textContent = 'Error en el Worker.';
        btn.disabled  = false;
        btn.innerHTML = '<span>🎲</span> Reintentar Simulación';
        worker.terminate();
    };

    worker.postMessage({ data: WORLD_CUP_DATA, iterations: iters, modelType });
}

function displaySimulationResults(results) {
    const tbody = document.getElementById('simTableBody');
    if (!tbody) return;

    const sorted   = [...results].sort((a, b) => b.champion - a.champion);
    const maxChamp = sorted[0]?.champion || 1;

    tbody.innerHTML = sorted.map((t, i) => {
        const champClass    = t.champion >= 8 ? 'high' : t.champion >= 3 ? 'medium' : 'low';
        const teamData      = WORLD_CUP_DATA.teams[t.team];
        const champBarWidth = Math.round((t.champion / maxChamp) * 100);
        return `
            <tr class="${i < 3 ? 'sim-top3' : ''}">
                <td class="sim-rank-cell">${i < 3 ? ['🥇','🥈','🥉'][i] : i + 1}</td>
                <td class="sim-flag-cell">${teamData?.flagHtml || t.flag}</td>
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

    // Embudo de probabilidad
    const bracketDiv = document.getElementById('simBracket');
    if (bracketDiv) {
        bracketDiv.style.display = 'block';
        const r16Teams = [...results].sort((a, b) => b.roundOf16    - a.roundOf16).slice(0, 16);
        const qfTeams  = [...results].sort((a, b) => b.quarterFinals - a.quarterFinals).slice(0, 8);
        const sfTeams  = [...results].sort((a, b) => b.semiFinals   - a.semiFinals).slice(0, 4);
        const fTeams   = [...results].sort((a, b) => b.final        - a.final).slice(0, 2);
        const champ    = sorted[0];
        const getHtml  = t => WORLD_CUP_DATA.teams[t]?.flagHtml || '🏳️';

        bracketDiv.innerHTML = `
            <h3 style="text-align:center;margin-bottom:0.5rem;color:var(--accent-primary-light)">Embudos de Probabilidad (Top Equipos por Fase)</h3>
            <p style="text-align:center;font-size:0.85rem;color:var(--text-muted);margin-bottom:1.5rem">Equipos con mayor % de llegar a cada fase según Monte Carlo.</p>
            <div style="display:flex;flex-direction:column;gap:15px;background:var(--bg-glass);padding:20px;border-radius:12px">
                <div style="text-align:center;background:rgba(255,215,0,0.1);padding:20px;border-radius:16px;">
                    <div style="font-size:0.8rem;color:var(--accent-gold);letter-spacing:1px;margin-bottom:5px">🏆 CAMPEÓN MÁS PROBABLE</div>
                    <div style="font-size:1.8rem;">${getHtml(champ.team)} <b>${champ.team}</b></div>
                </div>
                <div style="display:flex;justify-content:center;gap:2rem;padding:10px;border-bottom:1px solid rgba(255,255,255,0.05)">
                    <div style="text-align:center"><div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:5px">FINALISTAS</div>
                    <div style="display:flex;gap:1.5rem;font-size:1.1rem">${fTeams.map(t => `<div>${getHtml(t.team)} ${t.team}</div>`).join('')}</div></div>
                </div>
                <div style="display:flex;justify-content:center;gap:2rem;padding:10px;border-bottom:1px solid rgba(255,255,255,0.05)">
                    <div style="text-align:center"><div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:5px">SEMIFINALISTAS</div>
                    <div style="display:flex;gap:1.5rem;font-size:1rem;flex-wrap:wrap;justify-content:center">${sfTeams.map(t => `<div>${getHtml(t.team)} ${t.team}</div>`).join('')}</div></div>
                </div>
                <div style="display:flex;justify-content:center;gap:2rem;padding:10px;border-bottom:1px solid rgba(255,255,255,0.05)">
                    <div style="text-align:center"><div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:5px">CUARTOS DE FINAL</div>
                    <div style="display:flex;gap:1.2rem;font-size:0.9rem;flex-wrap:wrap;justify-content:center;color:var(--text-secondary)">${qfTeams.map(t => `<div>${getHtml(t.team)} ${t.team}</div>`).join('')}</div></div>
                </div>
                <div style="display:flex;justify-content:center;gap:2rem;padding:10px">
                    <div style="text-align:center"><div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:5px">OCTAVOS DE FINAL</div>
                    <div style="display:flex;gap:1rem;font-size:0.85rem;flex-wrap:wrap;justify-content:center;color:var(--text-muted)">${r16Teams.map(t => `<div>${getHtml(t.team)} ${t.team}</div>`).join('')}</div></div>
                </div>
            </div>
        `;
    }
}

// ============================================================
// TAB RESULTADOS REALES
// ============================================================
function populateResultsSelectors() {
    const selA = document.getElementById('resultTeamA');
    const selB = document.getElementById('resultTeamB');
    if (!selA || !selB) return;

    // Resetear
    selA.innerHTML = '<option value="">Seleccionar equipo...</option>';
    selB.innerHTML = '<option value="">Seleccionar equipo...</option>';

    Object.keys(WORLD_CUP_DATA.groups).forEach(group => {
        const teams = WORLD_CUP_DATA.groups[group];
        const ogA = document.createElement('optgroup');
        const ogB = document.createElement('optgroup');
        ogA.label = ogB.label = `── Grupo ${group} ──`;
        teams.forEach(team => {
            const flag = WORLD_CUP_DATA.teams[team]?.flag || '🏳️';
            ogA.appendChild(new Option(`${flag} ${team}`, team));
            ogB.appendChild(new Option(`${flag} ${team}`, team));
        });
        selA.appendChild(ogA);
        selB.appendChild(ogB);
    });

    // Fecha por defecto: hoy
    const dateInput = document.getElementById('resultDate');
    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];
}

function setupResultsTab() {
    // Guardar resultado
    document.getElementById('saveResultBtn')?.addEventListener('click', saveResult);

    // Exportar JSON
    document.getElementById('exportResultsBtn')?.addEventListener('click', () => {
        const json = resultsManager.exportJSON();
        const blob = new Blob([json], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `WC2026_Resultados_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    });

    // Importar JSON
    document.getElementById('importResultsFile')?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const res = resultsManager.importJSON(ev.target.result, engine);
            if (res.error) {
                alert(`Error importando: ${res.error}`);
            } else {
                alert(`✅ Importados: ${res.imported.results} resultados, ${res.imported.predictions} predicciones.`);
                renderResultsList();
                renderPerformance();
                updateCalibrationDisplay();
            }
            e.target.value = '';
        };
        reader.readAsText(file);
    });

    // Limpiar todo
    document.getElementById('clearResultsBtn')?.addEventListener('click', () => {
        if (!confirm('¿Seguro que deseas eliminar todos los resultados y predicciones? Esta acción no se puede deshacer.')) return;
        resultsManager.clearAll(engine);
        renderResultsList();
        renderPerformance();
        updateCalibrationDisplay();
        showFormStatus('', '');
    });
}

async function saveResult() {
    const teamA  = document.getElementById('resultTeamA').value;
    const teamB  = document.getElementById('resultTeamB').value;
    const goalsA = parseInt(document.getElementById('resultGoalsA').value);
    const goalsB = parseInt(document.getElementById('resultGoalsB').value);
    const date   = document.getElementById('resultDate').value;
    const stage  = document.getElementById('resultStage').value;

    if (!teamA || !teamB)   return showFormStatus('Selecciona los dos equipos.', 'error');
    if (teamA === teamB)    return showFormStatus('Los equipos deben ser diferentes.', 'error');
    if (isNaN(goalsA) || isNaN(goalsB)) return showFormStatus('Ingresa marcadores válidos.', 'error');

    const btn  = document.getElementById('saveResultBtn');
    const orig = btn.innerHTML;
    btn.disabled  = true;
    btn.innerHTML = '⏳ Guardando y sincronizando...';

    await delay(30);

    // FASE 6: Usar addResultAndSync() para guardar local + sincronizar con backend
    const res = await resultsManager.addResultAndSync(
        { teamA, teamB, goalsA, goalsB, date, competition: 'FIFA World Cup 2026', stage },
        engine
    );

    if (res.error) {
        showFormStatus(`Error: ${res.error}`, 'error');
    } else {
        const upd = res.updateInfo;
        let msg = `✅ Resultado ${teamA} ${goalsA}–${goalsB} ${teamB} guardado.`;
        if (upd && !upd.error) {
            msg += ` ELO: ${teamA} ${upd.eloChangeA > 0 ? '+' : ''}${upd.eloChangeA} → ${upd.newEloA} | ${teamB} ${upd.eloChangeB > 0 ? '+' : ''}${upd.eloChangeB} → ${upd.newEloB}`;
        }
        // Indicar si se sincronizó con el backend
        if (res.sync?.backend) msg += ' · ☁️ Compartido';
        showFormStatus(msg, 'success');

        // Resetear goles
        document.getElementById('resultGoalsA').value = '0';
        document.getElementById('resultGoalsB').value = '0';

        renderResultsList();
        updateCalibrationDisplay();

        if (document.getElementById('section-performance')?.classList.contains('active')) {
            renderPerformance();
        }
    }

    btn.disabled  = false;
    btn.innerHTML = orig;
}

function showFormStatus(msg, type) {
    const el = document.getElementById('resultFormStatus');
    if (!el) return;
    if (!msg) { el.style.display = 'none'; return; }
    el.textContent   = msg;
    el.className     = `form-status-msg ${type}`;
    el.style.display = 'block';
    if (type === 'success') setTimeout(() => { el.style.display = 'none'; }, 6000);
}

function renderResultsList() {
    const list    = document.getElementById('resultsList');
    const counter = document.getElementById('resultsCount');
    if (!list) return;

    const results = resultsManager.getResults();
    if (counter) counter.textContent = results.length;

    if (results.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📭</div>
                <p>No hay resultados registrados todavía.</p>
                <p style="font-size:0.82rem;">Registra el primer partido para comenzar el aprendizaje incremental.</p>
            </div>`;
        return;
    }

    list.innerHTML = results.map(r => {
        const flagA = WORLD_CUP_DATA.teams[r.teamA]?.flagHtml || '🏳️';
        const flagB = WORLD_CUP_DATA.teams[r.teamB]?.flagHtml || '🏳️';
        const winner = r.goalsA > r.goalsB ? r.teamA : r.goalsA < r.goalsB ? r.teamB : 'Empate';
        const winnerLabel = r.goalsA === r.goalsB ? '🤝 Empate' : `🏆 ${winner}`;
        const eloInfo = r.updateInfo && !r.updateInfo.error
            ? `<span class="r-elo-badge">ELO actualizado • ${r.updateInfo.matchesProcessed} pts proc.</span>`
            : '';
        return `
            <div class="results-list-item">
                <div class="r-teams">
                    ${flagA} ${r.teamA}
                    <span class="r-score">${r.goalsA}–${r.goalsB}</span>
                    ${r.teamB} ${flagB}
                </div>
                <div style="display:flex;flex-direction:column;gap:3px;align-items:flex-end">
                    <div class="r-meta">${r.date} · ${r.stage}</div>
                    <div class="r-meta">${winnerLabel}</div>
                    ${eloInfo}
                </div>
                <button class="btn-delete-result" onclick="deleteResult('${r.id}')">🗑️</button>
            </div>
        `;
    }).join('');
}

window.deleteResult = function (id) {
    if (!confirm('¿Eliminar este resultado? El ELO no se revertirá automáticamente.')) return;
    const res = resultsManager.deleteResult(id, engine);
    if (res.success) {
        renderResultsList();
        renderPerformance();
    } else {
        alert('Error eliminando el resultado.');
    }
};

// ============================================================
// TAB DESEMPEÑO
// ============================================================
function renderPerformance() {
    const container = document.getElementById('performanceMetrics');
    if (!container) return;

    const metrics = resultsManager ? resultsManager.getQuickMetrics() : null;

    if (!metrics) {
        container.innerHTML = `
            <div class="empty-state glass-card">
                <div class="empty-icon">📊</div>
                <p>Aquí aparecerán las métricas del modelo.</p>
                <p style="font-size:0.82rem;">Para calcular métricas necesitas: <br>
                1. Ejecutar una predicción (tab ⚡ Predictor)<br>
                2. Registrar el resultado real (tab 📝 Resultados)</p>
            </div>`;
        return;
    }

    // Tarjetas de métricas básicas siempre visibles
    let basicHtml = `
        <div class="perf-section-title">📊 Estadísticas Generales</div>
        <div class="metric-cards-grid">
            <div class="metric-card blue">
                <div class="mc-label">Partidos Registrados</div>
                <div class="mc-value">${metrics.totalMatches}</div>
                <div class="mc-sub">resultados reales</div>
            </div>
            <div class="metric-card gold">
                <div class="mc-label">Goles/Partido Prom.</div>
                <div class="mc-value">${metrics.avgGoalsPerMatch}</div>
                <div class="mc-sub">promedio real</div>
            </div>
            <div class="metric-card purple">
                <div class="mc-label">Tasa de Empates</div>
                <div class="mc-value">${metrics.drawRate}%</div>
                <div class="mc-sub">partidos empatados</div>
            </div>
        </div>
    `;

    if (!metrics.hasMetrics) {
        container.innerHTML = basicHtml + `
            <div class="glass-card" style="text-align:center;padding:2rem;color:var(--text-muted);">
                <p>Para ver métricas de precisión del modelo, necesitas haber ejecutado predicciones <em>antes</em> de los partidos.</p>
                <p style="font-size:0.82rem;">Las predicciones guardadas se comparan automáticamente con los resultados reales al registrarlos.</p>
            </div>`;
        return;
    }

    // Métricas completas de precisión
    const accColor = metrics.accuracy.winner >= 60 ? 'green' : metrics.accuracy.winner >= 50 ? 'gold' : 'red';
    const exactColor = metrics.accuracy.exactScore >= 30 ? 'green' : metrics.accuracy.exactScore >= 20 ? 'gold' : 'red';

    let historyHtml = '';
    if (metrics.history?.length > 0) {
        // Mini gráfica de tendencia (barras de running accuracy)
        const maxAcc = 100;
        historyHtml = `
            <div class="perf-section-title">📈 Tendencia de Precisión</div>
            <div class="trend-chart-wrap">
                <div style="font-size:0.8rem;color:var(--text-muted);">% Aciertos acumulados (ganador) por partido evaluado</div>
                <div class="trend-chart-bars">
                    ${metrics.history.map(h => {
                        const heightPct = Math.round((h.runningAccuracy / maxAcc) * 100);
                        const color = h.runningAccuracy >= 60 ? '#22c55e' : h.runningAccuracy >= 50 ? '#f59e0b' : '#f87171';
                        return `<div class="trend-bar-item"
                            style="height:${heightPct}%;background:${color};opacity:0.85;"
                            data-tip="${h.teams}: ${h.runningAccuracy}%">
                        </div>`;
                    }).join('')}
                </div>
            </div>
            <div class="perf-section-title">📜 Historial Detallado</div>
            <div style="overflow-x:auto;background:var(--bg-primary);border-radius:12px;border:1px solid var(--border-glass);padding:1px;">
                <table class="history-table">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Fecha</th>
                            <th>Partido</th>
                            <th>Ganador</th>
                            <th>Exacto</th>
                            <th>Acc. Acum.</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${metrics.history.map(h => `
                            <tr>
                                <td style="color:var(--text-muted)">${h.idx}</td>
                                <td style="color:var(--text-muted)">${h.date}</td>
                                <td>${h.teams}</td>
                                <td class="${h.correct ? 'badge-correct' : 'badge-incorrect'}">${h.correct ? '✅ Sí' : '❌ No'}</td>
                                <td class="${h.exactScore ? 'badge-exact' : ''}">${h.exactScore ? '🎯 Sí' : '—'}</td>
                                <td>
                                    <div>${h.runningAccuracy}%</div>
                                    <div class="trend-bar-wrap">
                                        <div class="trend-bar-fill" style="width:${h.runningAccuracy}%;background:${h.runningAccuracy >= 60 ? '#22c55e' : h.runningAccuracy >= 50 ? '#f59e0b' : '#f87171'}"></div>
                                    </div>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    container.innerHTML = basicHtml + `
        <div class="perf-section-title">🎯 Precisión del Modelo (${metrics.evaluatedMatches} predicciones evaluadas)</div>
        <div class="metric-cards-grid">
            <div class="metric-card ${accColor}">
                <div class="mc-label">Ganador Acertado</div>
                <div class="mc-value">${metrics.accuracy.winner}%</div>
                <div class="mc-sub">objetivo: ≥55%</div>
            </div>
            <div class="metric-card ${exactColor}">
                <div class="mc-label">Marcador Exacto</div>
                <div class="mc-value">${metrics.accuracy.exactScore}%</div>
                <div class="mc-sub">objetivo: ≥30%</div>
            </div>
        </div>
        <div class="perf-section-title">📉 Métricas Estadísticas Avanzadas</div>
        <div class="metric-cards-grid">
            <div class="metric-card blue">
                <div class="mc-label">Log Loss</div>
                <div class="mc-value" style="font-size:1.4rem">${metrics.logLoss}</div>
                <div class="mc-sub">menor es mejor (óptimo &lt;0.90)</div>
            </div>
            <div class="metric-card purple">
                <div class="mc-label">Brier Score</div>
                <div class="mc-value" style="font-size:1.4rem">${metrics.brierScore}</div>
                <div class="mc-sub">menor es mejor (óptimo &lt;0.20)</div>
            </div>
            <div class="metric-card gold">
                <div class="mc-label">MAE Goles</div>
                <div class="mc-value" style="font-size:1.4rem">${metrics.maeGoals}</div>
                <div class="mc-sub">error abs. promedio en goles</div>
            </div>
            <div class="metric-card blue">
                <div class="mc-label">RMSE Goles</div>
                <div class="mc-value" style="font-size:1.4rem">${metrics.rmseGoals}</div>
                <div class="mc-sub">error cuadrático de goles</div>
            </div>
        </div>
        ${historyHtml}
    `;
}

function updateCalibrationDisplay() {
    if (!engine) return;
    const cal = engine._calibration;
    const el  = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };

    el('calMatchesProcessed', cal.matchesProcessed);
    el('calBiasCorrection',   `${(cal.biasCorrection * 100).toFixed(2)}%`);
    el('calRhoDynamic',       cal.rhoDynamic?.toFixed(4) ?? '-0.0800');

    const savedAt = resultsManager?._calibration?.savedAt;
    el('calLastUpdate', savedAt ? new Date(savedAt).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '—');
}

// ============================================================
// FASE 7 — VARIABLES CONTEXTUALES
// Lee los valores del panel de factores contextuales en la UI
// ============================================================
function getContextualFactors() {
    const getValue = (id, defaultVal = 0) => {
        const el = document.getElementById(id);
        return el ? (parseFloat(el.value) || defaultVal) : defaultVal;
    };
    const getCheck = (id) => {
        const el = document.getElementById(id);
        return el ? el.checked : false;
    };

    return {
        teamA: {
            injuredStars:   getValue('ctx-inj-a'),
            suspendedKey:   getValue('ctx-sus-a'),
            restDays:       getValue('ctx-rest-a', 7),
            altitudeEffect: false,  // Solo aplica al visitante
        },
        teamB: {
            injuredStars:   getValue('ctx-inj-b'),
            suspendedKey:   getValue('ctx-sus-b'),
            restDays:       getValue('ctx-rest-b', 7),
            altitudeEffect: getCheck('ctx-altitude'),
            weatherPenalty: getValue('ctx-weather') / 100
        },
        altitude: getCheck('ctx-altitude'),
        weather:  getValue('ctx-weather')
    };
}

// Memoria para revertir ajustes contextuales de ELO
let _eloBackup = {};

/**
 * Aplica ajustes de ELO temporales basados en factores contextuales.
 * Fórmula: cada jugador clave lesionado = -20 ELO (max -60 total)
 * Esto asegura impacto acotado y reversible.
 */
function applyContextualEloAdjustment(teamA, teamB, factors) {
    _eloBackup = {};
    if (!engine || !engine.teams) return;

    const adjust = (teamName, teamFactors, isHome) => {
        if (!engine.teams[teamName]) return;
        const original = engine.teams[teamName].eloRating;
        _eloBackup[teamName] = original;

        let delta = 0;
        // Lesiones: cada estrella = -20 ELO (máx -60)
        delta -= Math.min(3, teamFactors.injuredStars || 0) * 20;
        // Sanciones: -15 por suspendido clave (máx -30)
        delta -= Math.min(2, teamFactors.suspendedKey || 0) * 15;
        // Altitud (visitante): -25 ELO
        if (!isHome && (factors.altitude || teamFactors.altitudeEffect)) delta -= 25;
        // Fatiga (<4 días descanso): -15 ELO
        if ((teamFactors.restDays || 7) < 4) delta -= 15;

        // Capping: máximo ±60 ELO de ajuste contextual
        const cappedDelta = Math.max(-60, Math.min(0, delta));
        if (cappedDelta !== 0) {
            engine.teams[teamName].eloRating = original + cappedDelta;
            engine._strengthCache = {};
        }
    };

    adjust(teamA, factors.teamA, true);
    adjust(teamB, factors.teamB, false);
}

function revertContextualEloAdjustment(teamA, teamB) {
    if (_eloBackup[teamA] && engine.teams[teamA]) {
        engine.teams[teamA].eloRating = _eloBackup[teamA];
    }
    if (_eloBackup[teamB] && engine.teams[teamB]) {
        engine.teams[teamB].eloRating = _eloBackup[teamB];
    }
    engine._strengthCache = {};
    _eloBackup = {};
}

// ============================================================
// FASE 8-9 — INTEGRACIÓN GEMINI IA
// ============================================================

/**
 * Lanza el análisis Gemini en background tras una predicción.
 * Siempre muestra el tab de IA disponible; el análisis llega de forma asíncrona.
 */
async function triggerAIAnalysis(teamA, teamB, prediction, contextFactors = {}) {
    // Generar clave de cache
    const cacheKey = `${teamA}_${teamB}_${prediction.winA}`;

    // Preparar el tab de IA para mostrar loading
    const aiSection = document.getElementById('section-ai-analysis');
    if (aiSection) {
        showAILoading(teamA, teamB, prediction);
        // Activar el badge del tab
        const aiTab = document.querySelector('[data-tab="ai-analysis"]');
        if (aiTab) aiTab.classList.add('tab-new-data');
    }

    // Si ya tenemos análisis en cache, usarlo
    if (_aiAnalysisCache[cacheKey]) {
        renderAIAnalysis(_aiAnalysisCache[cacheKey]);
        return;
    }

    // Cancelar petición anterior si existe
    if (_aiAnalysisAbort) _aiAnalysisAbort.abort();
    _aiAnalysisAbort = new AbortController();

    try {
        // Construir descripción de factores contextuales para Gemini
        const contextualDesc = {};
        if (contextFactors.teamA?.injuredStars > 0) {
            contextualDesc[`Lesiones ${teamA}`] = `${contextFactors.teamA.injuredStars} jugador(es) clave`;
        }
        if (contextFactors.teamB?.injuredStars > 0) {
            contextualDesc[`Lesiones ${teamB}`] = `${contextFactors.teamB.injuredStars} jugador(es) clave`;
        }
        if (contextFactors.altitude) {
            contextualDesc['Altitud'] = 'Sede a >2000m — desventaja visitante';
        }

        const keyRes = await fetch('/api/get-key');
        const keyData = await keyRes.json();
        if (!keyRes.ok) throw new Error(keyData.error || 'Error configurando IA');
        const GEMINI_API_KEY = keyData.key;
        const GEMINI_MODEL = 'gemini-3.1-flash-lite';

        const { lambdaA, lambdaB, topScores = [], eloDiff } = prediction;
        const eloStr = eloDiff > 0 ? `${teamA} superior por ${Math.abs(eloDiff)} ELO` : eloDiff < 0 ? `${teamB} superior por ${Math.abs(eloDiff)} ELO` : 'Equipos parejos';
        const ctxStr = Object.entries(contextualDesc).filter(([,v])=>v).map(([k,v])=>`- ${k}: ${v}`).join('\n');
        
        const prompt = `Eres analista experto del Mundial FIFA 2026. Responde en español con markdown.
PARTIDO: ${teamA} vs ${teamB}
PROBABILIDADES: ${teamA} ${prediction.winA}% | Empate ${prediction.draw}% | ${teamB} ${prediction.winB}%
GOLES ESPERADOS: λ${teamA}=${lambdaA} | λ${teamB}=${lambdaB} | Total=${(parseFloat(lambdaA)+parseFloat(lambdaB)).toFixed(2)}
${ctxStr ? `\nCONTEXTO:\n${ctxStr}` : ''}
Genera un análisis experto y exhaustivo. No tienes límite de palabras.`;

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
        let contents = [{ role: 'user', parts: [{ text: prompt }] }];
        let finalAnalysis = "";
        let finalFinishReason = "STOP";
        let iterations = 0;
        const MAX_ITERATIONS = 4;

        while (iterations < MAX_ITERATIONS) {
            iterations++;
            const geminiReqBody = {
                contents,
                generationConfig: { temperature: 0.7, topK: 40, topP: 0.95, maxOutputTokens: 2048 },
                safetySettings: [
                    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
                ]
            };

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(geminiReqBody),
                signal: _aiAnalysisAbort.signal
            });

            const data = await response.json();
            if (!response.ok) throw new Error(`Gemini API Error: ${data.error?.message || response.status}`);

            const textChunk = data.candidates?.[0]?.content?.parts?.[0]?.text;
            const finishReason = data.candidates?.[0]?.finishReason;
            
            if (!textChunk) {
                if (finalAnalysis === "") throw new Error(`Respuesta vacía de Gemini. Razón: ${finishReason || 'desconocida'}`);
                break;
            }

            finalAnalysis += textChunk;
            finalFinishReason = finishReason;

            if (finishReason === 'MAX_TOKENS' && iterations < MAX_ITERATIONS) {
                contents.push({ role: 'model', parts: [{ text: textChunk }] });
                contents.push({ role: 'user', parts: [{ text: "Continúa el análisis exactamente donde te quedaste, de forma fluida, sin repetir el texto anterior." }] });
            } else {
                break;
            }
        }

        const data = {
            success: true,
            analysis: finalAnalysis,
            finishReason: finalFinishReason + ` (Iter: ${iterations})`,
            teamA,
            teamB,
            probabilities: prediction,
            generatedAt: new Date().toISOString(),
            model: GEMINI_MODEL
        };

        // Guardar en cache
        _aiAnalysisCache[cacheKey] = data;
        renderAIAnalysis(data);

    } catch (err) {
        if (err.name === 'AbortError') return; // Cancelado por el usuario
        showAIError(err.message, teamA, teamB, prediction, contextFactors);
    }
}

/** Muestra estado de carga del análisis IA */
function showAILoading(teamA, teamB, prediction) {
    const container = document.getElementById('ai-analysis-content');
    if (!container) return;

    const dataA = WORLD_CUP_DATA?.teams[teamA];
    const dataB = WORLD_CUP_DATA?.teams[teamB];

    container.innerHTML = `
        <div class="ai-match-header">
            <div class="ai-team-badge">${dataA?.flagHtml || '🏳️'} <strong>${teamA}</strong></div>
            <div class="ai-prob-trio">
                <div class="ai-prob-item win-a">
                    <div class="ai-prob-pct">${prediction.winA}%</div>
                    <div class="ai-prob-lbl">Victoria</div>
                </div>
                <div class="ai-prob-item draw-v">
                    <div class="ai-prob-pct">${prediction.draw}%</div>
                    <div class="ai-prob-lbl">Empate</div>
                </div>
                <div class="ai-prob-item win-b">
                    <div class="ai-prob-pct">${prediction.winB}%</div>
                    <div class="ai-prob-lbl">Victoria</div>
                </div>
            </div>
            <div class="ai-team-badge"><strong>${teamB}</strong> ${dataB?.flagHtml || '🏳️'}</div>
        </div>
        <div class="ai-score-chip">⚽ Marcador más probable: <strong>${prediction.mostLikelyScore}</strong></div>
        <div class="ai-loading-state">
            <div class="ai-spinner-wrap">
                <img src="MR24.png" alt="Cargando" class="ai-custom-logo" />
                <div class="ai-loading-text">Gemini está analizando el partido...</div>
                <div class="ai-loading-sub">Procesando datos del motor Poisson-Dixon-Coles</div>
            </div>
        </div>
    `;
}

/** Renderiza el análisis de Gemini como HTML formateado */
function renderAIAnalysis(data) {
    const container = document.getElementById('ai-analysis-content');
    if (!container) return;

    const { teamA, teamB, analysis, probabilities, generatedAt, model, fromCache } = data;
    const dataA = WORLD_CUP_DATA?.teams[teamA];
    const dataB = WORLD_CUP_DATA?.teams[teamB];

    // Convertir markdown básico a HTML (versión segura)
    const mdToHtml = (text) => {
        if (!text) return '';
        let html = text.replace(/\r\n/g, '\n');
        
        // Evitar que etiquetas no cerradas (ej. <tactica>) rompan el DOM
        html = html.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
        
        html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
        html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul class="ai-list">$&</ul>');
        
        html = html.replace(/^### (.+)$/gm, '<h4 class="ai-section-h4">$1</h4>');
        html = html.replace(/^## (.+)$/gm, '<h3 class="ai-section-h">$1</h3>');
        
        // Separar por bloques y añadir <p> de forma segura
        html = html.split(/\n\n+/).map(block => {
            block = block.trim();
            if (!block) return '';
            // Si el bloque ya es un HTML block element, no lo envolvemos en p
            if (block.startsWith('<h') || block.startsWith('<ul')) {
                return block;
            }
            return `<p class="ai-para">${block.replace(/\n/g, '<br>')}</p>`;
        }).join('\n');
        
        return html;
    };

    const timeStr = generatedAt ? new Date(generatedAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : '';
    const cacheTag = fromCache ? '<span class="ai-cache-badge">📦 Desde caché</span>' : '';
    const debugTag = data.finishReason ? `<span style="font-size:0.75rem; color: #ffb74d; margin-left:10px;">[Debug: ${data.finishReason} | ${analysis.length} chars]</span>` : '';

    container.innerHTML = `
        <div class="ai-match-header">
            <div class="ai-team-badge">${dataA?.flagHtml || '🏳️'} <strong>${teamA}</strong></div>
            <div class="ai-prob-trio">
                <div class="ai-prob-item win-a">
                    <div class="ai-prob-pct">${probabilities?.winA ?? '—'}%</div>
                    <div class="ai-prob-lbl">Victoria</div>
                </div>
                <div class="ai-prob-item draw-v">
                    <div class="ai-prob-pct">${probabilities?.draw ?? '—'}%</div>
                    <div class="ai-prob-lbl">Empate</div>
                </div>
                <div class="ai-prob-item win-b">
                    <div class="ai-prob-pct">${probabilities?.winB ?? '—'}%</div>
                    <div class="ai-prob-lbl">Victoria</div>
                </div>
            </div>
            <div class="ai-team-badge"><strong>${teamB}</strong> ${dataB?.flagHtml || '🏳️'}</div>
        </div>
        <div class="ai-score-chip">⚽ Marcador más probable: <strong>${probabilities?.mostLikelyScore || '—'}</strong></div>
        <div class="ai-meta-row">
            <span class="ai-model-badge">🤖 ${model || 'gemini-2.0-flash'}</span>
            ${timeStr ? `<span class="ai-time-badge">🕐 ${timeStr}</span>` : ''}
            ${cacheTag}
            ${debugTag}
        </div>
        <div class="ai-analysis-body">
            ${mdToHtml(analysis)}
        </div>
    `;

    // Quitar badge del tab
    const aiTab = document.querySelector('[data-tab="ai-analysis"]');
    if (aiTab) aiTab.classList.remove('tab-new-data');
}

/** Muestra estado de error con botón de reintento */
function showAIError(errorMsg, teamA, teamB, prediction, contextFactors) {
    const container = document.getElementById('ai-analysis-content');
    if (!container) return;

    const isNoKey = errorMsg?.includes('MISSING_API_KEY') || errorMsg?.includes('no configurado');

    container.innerHTML = `
        <div class="ai-error-state">
            <div style="font-size:3rem;margin-bottom:1rem">${isNoKey ? '🔑' : '⚠️'}</div>
            <h3>${isNoKey ? 'Análisis IA no configurado' : 'Error al generar análisis'}</h3>
            <p style="color:var(--text-muted);font-size:0.9rem;max-width:500px;margin:0.5rem auto 1.5rem">
                ${isNoKey
                    ? 'La variable GEMINI_API_KEY no está configurada en Vercel. Consulta DEPLOY.md para instrucciones.'
                    : `${errorMsg || 'Error desconocido'}. El servidor Gemini puede estar temporalmente no disponible.`
                }
            </p>
            ${!isNoKey ? `
            <button class="predict-btn" onclick="triggerAIAnalysis('${teamA}', '${teamB}', _currentPredictionForAI?.result || {}, {})" style="max-width:200px">
                🔄 Reintentar
            </button>` : ''}
        </div>
    `;
}
