import { getCachedStats, isCacheReady, getSeasonMatchDelta } from './stats-cache-service.js';
import { allMatches } from './match-data-service.js';
import { MAX_GOALS } from './constants.js';
import Chart from "chart.js/auto";
import annotationPlugin from 'chartjs-plugin-annotation';
import { createTimelineWithLabel } from './match-timeline.js';
import { filterMatchesBySeason, getSelectedSeason } from './season-service.js';
import {
    computeSMA,
    computeEMA,
    computeRollingStdDev,
    computeBollingerBands,
    findDayBoundaries,
    buildDayBoundaryAnnotations,
    detectTrends,
    buildTrendAnnotations,
    buildTrendLineData,
    aggregateDailyCandles,
    candleCloseEMA,
    detectCandleTrends,
    candleBollingerBands,
} from './elo-chart-utils.js';

Chart.register(annotationPlugin);

// --- Persistent ELO chart preferences (survives player switches) ---
const ELO_CHART_PREFS_KEY = 'kickelo_eloChartPrefs';
function loadEloChartPrefs() {
    try {
        const raw = localStorage.getItem(ELO_CHART_PREFS_KEY);
        if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return { volatility: false, trends: false, range: '20d', mode: 'candle', smoothed: false };
}
function saveEloChartPrefs(prefs) {
    try { localStorage.setItem(ELO_CHART_PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
}

// Define the HTML template for the component using a template literal
const template = document.createElement('template');
template.innerHTML = `
    <style>
        
        /* Component-specific styles to keep things encapsulated */
        .modal-content {
            background-color: var(--background-color-dark);
            padding: 0;
            border-radius: 10px;
            box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
            width: 800px;
            max-width: 90%;
            height: 90vh;
            max-height: 90vh;
            display: flex;
            flex-direction: column;
            z-index: 1000;
        }
        
        :host-context(#playerStatsBackdrop.visible) .modal-content {
            opacity: 1;
            transform: translateY(0);
        }

        .modal-header {
            border-top-left-radius: 10px;
            border-top-right-radius: 10px;
            padding: 25px;
            padding-top: 10px;
            padding-bottom: 10px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid var(--border-color);
            z-index: 1001;
            position: sticky;
            top: 0;
            /*background-color: var(--background-color);*/
        }

        .modal-header h2 {
            margin: 0;
            font-size: 1.8em;
            color: var(--text-color-primary);
        }

        .close-btn {
            background: none;
            border: none;
            font-size: 2.5em;
            cursor: pointer;
            color: var(--text-color-secondary);
            line-height: 1;
            padding: 0 5px;
            transition: color 0.2s ease;
        }

        .close-btn:hover {
            color: var(--accent-color);
        }

        .modal-body-scrollable {
            flex-grow: 1;
            overflow-y: auto;
            padding: 10px;
            position: relative; /* New: Positioning context for the tooltip */
        }

        .stats-section {
            margin-bottom: 25px;
            background-color: var(--card-background-color);
            padding: 10px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        }

        .stats-section h3 {
            color: var(--text-color-primary);
            margin-top: 0;
            margin-bottom: 15px;
            font-size: 1.4em;
            border-bottom: 1px dashed var(--border-color);
            padding-bottom: 10px;
        }

        .chart-container {
            position: relative;
            height: 300px;
            width: 100%;
            background-color: var(--background-color-primary);
            border-radius: 5px;
            padding: 10px;
            box-sizing: border-box;
        }

        .elo-chart-controls {
            display: flex;
            gap: 14px;
            margin-bottom: 6px;
            font-size: 0.82em;
            color: var(--text-color-secondary);
            align-items: center;
            flex-wrap: wrap;
        }

        .elo-chart-controls label {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            cursor: pointer;
            user-select: none;
        }

        .elo-chart-controls input[type="checkbox"] {
            accent-color: #6cabc2;
        }

        .elo-chart-controls select {
            background: var(--background-color-primary);
            color: var(--text-color-secondary);
            border: 1px solid var(--border-color);
            border-radius: 4px;
            padding: 2px 6px;
            font-size: 1em;
            cursor: pointer;
            outline: none;
        }

        .elo-chart-controls .spacer {
            flex: 1;
        }

        .pie-charts-container {
            display: flex;
            flex-wrap: wrap;
            gap: 20px;
            justify-content: center;
        }

        .pie-chart-wrapper {
            flex: 1 1 250px; /* Allow charts to grow, shrink, and wrap */
            max-width: 400px; /* Prevent a single chart from becoming too large */
            margin: 0 auto;
        }

        .pie-chart-wrapper h4 {
            text-align: center;
            margin-bottom: 10px;
            color: var(--text-color-secondary);
        }

        .performance-snapshot-container {
            display: flex;
            justify-content: space-around;
            text-align: center;
            flex-wrap: wrap;
        }

        .snapshot-item {
            /* No longer needs position relative */
        }

        .snapshot-item h4 {
            font-size: 2.0em;
            margin: 0;
            color: var(--text-color-primary);
        }

        .snapshot-item p {
            margin: 10px;
            font-size: 0.9em;
            color: var(--text-color-secondary);
            display: inline-flex;
            align-items: center;
            gap: 4px;
        }

        .info-icon {
            display: inline-block;
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background-color: #888;
            color: var(--background-color-dark);
            text-align: center;
            font-size: 12px;
            line-height: 16px;
            font-weight: bold;
            cursor: pointer;
            user-select: none;
        }

        .tooltip {
            visibility: hidden;
            width: 0;
            background-color: #333;
            color: #fff;
            text-align: center;
            border-radius: 6px;
            padding: 8px;
            position: absolute; /* Now relative to the scrollable body */
            z-index: 10; /* Make sure it's on top */
            opacity: 0;
            transition: opacity 0.3s;
            font-size: 0.85em;
            /* Positioning is now handled by JavaScript */
        }

        .tooltip.visible {
            visibility: visible;
            opacity: 1;
        }

        /* Generic table style */
        .stats-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 15px;
            font-size: 0.95em;
        }

        .stats-table th,
        .stats-table td {
            border: 1px solid var(--border-color);
            padding: 4px 6px;
            text-align: left;
        }
        
        .stats-table th {
            background-color: var(--background-color-dark);
            color: var(--text-color-primary);
            font-weight: bold;cursor: pointer;
            position: relative;
        }

        .stats-table th.sort-asc::after,
        .stats-table th.sort-desc::after {
            content: '';
            position: absolute;
            right: 8px;
            top: 50%;
            transform: translateY(-50%);
            border: 4px solid transparent;
        }

        .stats-table th.sort-asc::after {
            border-bottom-color: var(--text-color-primary);
        }
        
        .stats-table th.sort-desc::after {
            border-top-color: var(--text-color-primary);
        }
        
        .stats-table tbody tr:nth-child(even) {
            background-color: var(--background-color-primary);
        }
        
        .stats-table tbody tr:hover {
            background-color: var(--hover-color);
        }
        
        .recent-matches-list {
            list-style: none;
            padding: 0;
            margin: 0;
        }

        .match-item {
            display: flex;
            flex-direction: column;
            align-items: stretch;
            justify-content: flex-start;
            padding: 10px 12px;
            background-color: var(--background-color-primary);
            margin-bottom: 6px;
            border-radius: 6px;
            border-left: 5px solid transparent;
            transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .match-info-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        
        .match-item.win {
            border-left-color: #86e086;
        }
        
        .match-item.loss {
            border-left-color: #ff7b7b;
        }            
        
        .match-results {
            display: flex;
            align-items: center;
            gap: 12px;
            text-align: right;
        }
        
        .match-info {
            font-size: 0.9em;
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            flex: 1;
            min-width: 0;
        }
         
        .team-display {
            display: inline-block;
            white-space: nowrap;
        }
        
        .match-score {
            font-weight: 600;
            font-size: 1.1em;
            display: inline-block;
            flex-shrink: 0;
            margin: 0 4px;
        }
        
        .elo-change {
            flex-shrink: 0;
            min-width: 45px;
            text-align: right;
        }

    </style>
    <div class="modal-content">
        <div class="modal-header">
            <h2 id="playerStatsName"></h2>
            <button class="close-btn">&times;</button>
        </div>
        <div class="modal-body-scrollable">
            <div id="loading" style="text-align: center; padding: 20px;">
                <p>Loading player statistics...</p>
            </div>
            <div id="stats-content" style="display: none;">
                <!-- ELO Trajectory Section -->
                <div class="stats-section">
                    <h3>ELO Trajectory</h3>
                    <div class="elo-chart-controls">
                        <label><input type="checkbox" id="toggleSmoothed" /> Smoothed</label>
                        <label><input type="checkbox" id="toggleBollinger" checked /> Volatility</label>
                        <label><input type="checkbox" id="toggleTrends" checked /> Trends</label>
                        <span class="spacer"></span>
                        <select id="eloMode">
                            <option value="line">Line</option>
                            <option value="candle">Daily</option>
                        </select>
                        <select id="eloRange">
                            <option value="season">Season</option>
                            <option value="20d">Last 20 active days</option>
                            <option value="5d">Last 5 active days</option>
                        </select>
                    </div>
                    <div class="chart-container">
                        <canvas id="eloChart"></canvas>
                    </div>
                </div>
       
                <!-- Recent Matches Section -->
                <div id="recentMatchesContainer" class="stats-section">
                    <h3>Recent Matches</h3>
                    <ul class="recent-matches-list"></ul>
                </div>
                
                <!-- Performance Snapshot Section -->
                <div class="stats-section">
                    <h3>Performance Snapshot</h3>
                    <div id="performanceContainer" class="performance-snapshot-container">
                        <!-- Content will be rendered here -->
                    </div>
                </div>

                <!-- ELO Flow Section -->
                <div class="stats-section">
                    <h3>ELO Flow</h3>
                    <div id="eloFlowContainer" class="pie-charts-container"></div>
                </div>

                <!-- Opponent Stats Table Section -->
                <div id="winLossTableContainer" class="stats-section">
                    <h3>Win/Loss vs. Opponents</h3>
                </div>

                <!-- Teammate Stats Table Section -->
                <div id="teammateWinLossTableContainer" class="stats-section">
                    <h3>Win/Loss with Teammates</h3>
                </div>

                <!-- Goal Stats Section -->
                <div id="goalStatsSection" class="stats-section">
                    <h3>Goal Stats</h3>
                    <div id="goalStatsContent">
                        <!-- All-time goals and histogram will be rendered here -->
                        <div class="chart-container">
                            <canvas id="goalHistogramChart"></canvas>
                        </div>
                        <div style="font-size:1.2em; color: var(--text-color-primary); margin-top: 10px;">
                            All-time goals: <span id="allTimeGoals">-:-</span>
                        </div>
                    </div>
                </div>

                <!-- Goal Timing Stats Section -->
                <div id="goalTimingStats" class="stats-section">
                    <h3>Goal Timing Snapshot</h3>
                     <div id="goalTimingStatsContainer" class="performance-snapshot-container">
                        <!-- Content will be rendered here -->
                    </div>
                </div>
            </div>
        </div>
    </div>
`;


class PlayerStatsComponent extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.shadowRoot.appendChild(template.content.cloneNode(true));
        this.chartInstances = [];

        this.boundHideTooltip = this.hideTooltip.bind(this);
        const closeBtn = this.shadowRoot.querySelector('.close-btn');
        closeBtn.addEventListener('click', () => this.close());
    }

    connectedCallback() {
        this.playerName = this.getAttribute('player-name');
        if (!this.playerName) {
            console.error("Player name attribute is missing!");
            return;
        }
        this.boundSeasonChanged = () => this.loadPlayerStats();
        window.addEventListener('season-changed', this.boundSeasonChanged);
        this.loadPlayerStats();
    }

    disconnectedCallback() {
        if (this.boundSeasonChanged) {
            window.removeEventListener('season-changed', this.boundSeasonChanged);
        }
    }

    async loadPlayerStats() {
        if (!this.playerName) return;

        const loadingEl = this.shadowRoot.getElementById('loading');
        const statsContentEl = this.shadowRoot.getElementById('stats-content');
        loadingEl.style.display = 'block';
        statsContentEl.style.display = 'none';

        this.shadowRoot.getElementById('playerStatsName').textContent = this.playerName;

        try {
            // Check if stats cache is ready
            if (!isCacheReady()) {
                console.warn('Stats cache not ready yet. Waiting...');
                // Wait for stats-cache-updated event
                const waitForCache = new Promise((resolve) => {
                    const handler = () => {
                        window.removeEventListener('stats-cache-updated', handler);
                        resolve();
                    };
                    window.addEventListener('stats-cache-updated', handler);
                    // Timeout after 5 seconds
                    setTimeout(() => {
                        window.removeEventListener('stats-cache-updated', handler);
                        resolve();
                    }, 5000);
                });
                await waitForCache;
            }

            // Get all stats from cache in one operation
            const cachedStats = getCachedStats(this.playerName);
            
            if (!cachedStats) {
                throw new Error(`No stats found for player: ${this.playerName}`);
            }

            // Extract the stats we need from the cache
            const eloTrajectory = cachedStats.eloTrajectory;
            const winLossRatios = cachedStats.winLossRatios;
            const teammateRatios = cachedStats.winLossRatiosWithTeammates;
            const eloGainsLosses = cachedStats.eloGainsAndLosses;
            const longestStreaks = cachedStats.longestStreaks;
            const streakyness = cachedStats.streakyness;
            const goalStats = cachedStats.goalStats;
            const goalTimingStats = cachedStats.avgTimeBetweenGoals;

            this.renderEloGraph(eloTrajectory);
            this.renderRecentMatches();
            this.renderPerformanceSnapshot(longestStreaks, streakyness, cachedStats);
            this.renderEloFlowCharts(eloGainsLosses);
            this.renderWinLossTable(winLossRatios);
            this.renderTeammateWinLossTable(teammateRatios);
            this.renderGoalStats(goalStats);
            this.renderGoalTimingStats(goalTimingStats);

            loadingEl.style.display = 'none';
            statsContentEl.style.display = 'block';

        } catch (error) {
            console.error("Error loading player stats:", error);
            // ... (error handling)
        }
    }

    renderEloGraph(trajectoryData) {
        const canvas = this.shadowRoot.getElementById('eloChart');
        if (!canvas || !trajectoryData || trajectoryData.length === 0) return;

        // Load persisted preferences
        const prefs = loadEloChartPrefs();

        // Apply saved prefs to controls
        const bollingerToggle = this.shadowRoot.getElementById('toggleBollinger');
        const trendsToggle = this.shadowRoot.getElementById('toggleTrends');
        const smoothedToggle = this.shadowRoot.getElementById('toggleSmoothed');
        const rangeSelect = this.shadowRoot.getElementById('eloRange');
        const modeSelect = this.shadowRoot.getElementById('eloMode');
        if (bollingerToggle) bollingerToggle.checked = prefs.volatility;
        if (trendsToggle) trendsToggle.checked = prefs.trends;
        if (smoothedToggle) smoothedToggle.checked = prefs.smoothed ?? false;
        if (rangeSelect) rangeSelect.value = prefs.range;
        if (modeSelect) modeSelect.value = prefs.mode || 'line';

        // Store full trajectory + pre-compute analytics ONCE on the whole data
        this._eloFullTrajectory = trajectoryData;
        this._precomputeEloAnalytics(trajectoryData);

        // Render with current range/mode
        this._renderCurrentEloMode(canvas, prefs);
    }

    /** Pre-compute all analytics on the full trajectory. Called once per player load. */
    _precomputeEloAnalytics(trajectoryData) {
        const eloValues = trajectoryData.map(p => p.elo);
        const timestamps = trajectoryData.map(p => p.timestamp);
        const n = eloValues.length;

        // EMA
        const EMA_SPAN = Math.max(6, Math.min(14, Math.ceil(n / 4)));
        const ema = computeEMA(eloValues, EMA_SPAN);

        // Bollinger bands
        const BAND_WINDOW = Math.max(6, Math.min(14, Math.ceil(n / 4)));
        const stddev = computeRollingStdDev(eloValues, BAND_WINDOW);
        const { upper: bollingerUpper, lower: bollingerLower } = computeBollingerBands(ema, stddev, 1.5);

        // Day boundaries
        const dayBoundaries = findDayBoundaries(timestamps);
        const dayAnnotations = buildDayBoundaryAnnotations(dayBoundaries);

        // Trends (EMA crossover)
        const fastSpan = Math.max(4, Math.min(10, Math.ceil(n / 8)));
        const slowSpan = Math.max(8, Math.min(20, Math.ceil(n / 4)));
        const trendMinLen = Math.max(4, Math.ceil(slowSpan / 2));
        const trends = detectTrends(eloValues, fastSpan, slowSpan, trendMinLen);
        const { data: trendLineData, directions: trendDirections } = buildTrendLineData(eloValues, trends);
        const trendAnnotations = buildTrendAnnotations(trends);

        // Golden-goal indices
        const goldenGoalIndices = [];
        trajectoryData.forEach((p, i) => { if (p.isGoldenGoalWin) goldenGoalIndices.push(i); });

        // Active-day mapping: list of { startIdx, endIdx } for each active day
        const activeDays = [];
        let curDay = null;
        let curStart = 0;
        for (let i = 0; i < timestamps.length; i++) {
            const dayStr = new Date(timestamps[i]).toDateString();
            if (dayStr !== curDay) {
                if (curDay !== null) activeDays.push({ day: curDay, startIdx: curStart, endIdx: i - 1 });
                curDay = dayStr;
                curStart = i;
            }
        }
        if (curDay !== null) activeDays.push({ day: curDay, startIdx: curStart, endIdx: timestamps.length - 1 });

        // Candle data (pre-computed for daily mode)
        const candles = aggregateDailyCandles(trajectoryData);
        const candleN = candles.length;
        const candleEmaSpan = Math.max(3, Math.min(10, Math.ceil(candleN / 4)));
        const candleEma = candleCloseEMA(candles, candleEmaSpan);
        const candleFastSpan = Math.max(3, Math.min(6, Math.ceil(candleN / 6)));
        const candleSlowSpan = Math.max(5, Math.min(12, Math.ceil(candleN / 3)));
        const candleTrendMinLen = Math.max(3, Math.ceil(candleSlowSpan / 2));
        const candleTrends = detectCandleTrends(candles, candleFastSpan, candleSlowSpan, candleTrendMinLen);
        const { data: candleTrendLineData, directions: candleTrendDirections } = buildTrendLineData(candles.map(c => c.close), candleTrends);
        const candleTrendAnnotations = buildTrendAnnotations(candleTrends);
        const { upper: candleBollUpper, lower: candleBollLower } = candleBollingerBands(candles, candleEmaSpan, 1.5);

        this._eloAnalytics = {
            eloValues, timestamps, ema,
            bollingerUpper, bollingerLower,
            dayBoundaries, dayAnnotations,
            trendAnnotations, trendLineData, trendDirections, trends,
            goldenGoalIndices, activeDays,
            candles, candleEma, candleTrends,
            candleTrendAnnotations, candleTrendLineData, candleTrendDirections,
            candleBollUpper, candleBollLower,
        };
    }

    /** Compute the visible index range for the selected range option. */
    _getVisibleRange(range) {
        const { activeDays, eloValues } = this._eloAnalytics;
        const total = eloValues.length;
        if (range === 'season' || !range || activeDays.length === 0) return { min: 0, max: total - 1 };

        const numDays = range === '5d' ? 5 : 20;
        const slicedDays = activeDays.slice(-numDays);
        // Include one point before the first visible day for context
        const startIdx = Math.max(0, slicedDays[0].startIdx - 1);
        return { min: startIdx, max: total - 1 };
    }

    /** Compute the visible candle range for daily mode. */
    _getVisibleCandleRange(range) {
        const { candles } = this._eloAnalytics;
        const total = candles.length;
        if (range === 'season' || !range || total === 0) return { min: 0, max: total - 1 };
        const numDays = range === '5d' ? 5 : 20;
        return { min: Math.max(0, total - numDays), max: total - 1 };
    }

    /** Render the correct chart mode (line or candle). */
    _renderCurrentEloMode(canvas, prefs) {
        // Destroy previous chart
        if (this._eloChartRef) {
            this._eloChartRef.destroy();
            this.chartInstances = this.chartInstances.filter(c => c !== this._eloChartRef);
            this._eloChartRef = null;
        }

        if (prefs.mode === 'candle') {
            this._buildCandleChart(canvas, prefs);
        } else {
            this._buildLineChart(canvas, prefs);
        }

        this._wireEloChartControls(prefs);
    }

    /** Build the line-mode ELO chart. Analytics are pre-computed; only slicing the view. */
    _buildLineChart(canvas, prefs) {
        const a = this._eloAnalytics;
        const { eloValues, timestamps, ema, bollingerUpper, bollingerLower,
                dayAnnotations, trendAnnotations, trendLineData, trendDirections, goldenGoalIndices } = a;
        const labels = timestamps.map(t => new Date(t).toLocaleDateString());

        const showBoll = prefs.volatility;
        const showTrends = prefs.trends;
        const showSmoothed = prefs.smoothed ?? false;
        const { min: xMin, max: xMax } = this._getVisibleRange(prefs.range);

        // Golden-goal markers: point array with NaN everywhere except golden-goal indices
        const goldenData = new Array(eloValues.length).fill(null);
        for (const i of goldenGoalIndices) goldenData[i] = eloValues[i];

        const datasets = [
            // 0: Bollinger upper
            {
                label: 'Bollinger Upper',
                data: showBoll ? bollingerUpper : bollingerUpper.map(() => null),
                borderColor: 'transparent', backgroundColor: 'transparent',
                pointRadius: 0, pointHitRadius: 0, borderWidth: 0,
                fill: false, order: 6, spanGaps: false,
            },
            // 1: Bollinger lower (fill to upper)
            {
                label: 'Bollinger Lower',
                data: showBoll ? bollingerLower : bollingerLower.map(() => null),
                borderColor: 'transparent', backgroundColor: 'rgba(108, 171, 194, 0.10)',
                pointRadius: 0, pointHitRadius: 0, borderWidth: 0,
                fill: '-1', order: 5, spanGaps: false,
            },
            // 2: Raw ELO
            {
                label: 'ELO', data: eloValues,
                borderColor: showSmoothed ? 'rgba(108, 171, 194, 0.45)' : '#6cabc2',
                backgroundColor: showSmoothed ? 'rgba(108, 171, 194, 0.45)' : '#6cabc2',
                pointRadius: 0, borderWidth: showSmoothed ? 1.5 : 2.8, tension: 0, pointHitRadius: 20, order: 4,
            },
            // 3: EMA (smoothed)
            {
                label: 'Moving Avg',
                data: showSmoothed ? ema : ema.map(() => null),
                borderColor: '#6cabc2', backgroundColor: '#6cabc2',
                pointRadius: 0, borderWidth: 2.8, tension: 0.35,
                pointHitRadius: 0, spanGaps: true, order: 3,
            },
            // 4: Trend lines
            {
                label: 'Trend',
                data: showTrends ? trendLineData : trendLineData.map(() => null),
                borderColor: 'rgba(255,255,255,0.3)', backgroundColor: 'transparent',
                pointRadius: 0, borderWidth: 2, borderDash: [6, 3],
                tension: 0, pointHitRadius: 0, spanGaps: false,
                segment: {
                    borderColor: (ctx) => {
                        if (!ctx.p0 || !ctx.p1) return 'rgba(255,255,255,0.3)';
                        const dir = trendDirections[ctx.p1DataIndex];
                        return dir === 'up'
                            ? 'rgba(76, 175, 80, 0.7)' : 'rgba(244, 67, 54, 0.7)';
                    },
                }, order: 2,
            },
            // 5: Golden-goal markers
            {
                label: 'Golden Goal',
                data: goldenData,
                borderColor: '#ffd900c7', backgroundColor: '#ffd900c7',
                pointRadius: goldenData.map(v => v !== null ? 1.5 : 0),
                pointStyle: 'circle',
                borderWidth: 1.5, showLine: false,
                pointHitRadius: 8, order: 0,
            },
        ];

        // Annotations: day lines + optional trends
        const annotations = { ...dayAnnotations };
        if (showTrends) Object.assign(annotations, trendAnnotations);

        const chart = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: { labels, datasets },
            options: {
                animation: false,
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                scales: {
                    y: {
                        ticks: { color: '#ccc', maxTicksLimit: 6 },
                        grid: { color: 'rgba(170, 170, 170, 0.12)' },
                    },
                    x: {
                        min: xMin, max: xMax,
                        ticks: { color: '#ccc', maxTicksLimit: 10, maxRotation: 0 },
                        grid: { display: false },
                    },
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            title: (items) => {
                                if (!items.length) return '';
                                const idx = items[0].dataIndex;
                                return new Date(timestamps[idx]).toLocaleString();
                            },
                            label: (item) => {
                                const lbl = item.dataset.label;
                                if (lbl === 'Bollinger Upper' || lbl === 'Bollinger Lower') return null;
                                if (lbl === 'Trend' && item.parsed.y === null) return null;
                                const val = item.parsed.y;
                                if (val === null || val === undefined) return null;
                                if (lbl === 'Golden Goal') return `${lbl} Win: ${Math.round(val)}`;
                                return `${lbl}: ${Math.round(val)}`;
                            },
                        },
                        filter: (item) => item.parsed.y !== null && item.parsed.y !== undefined,
                    },
                    annotation: { annotations },
                },
            },
        });

        this.chartInstances.push(chart);
        this._eloChartRef = chart;
    }

    /** Build candlestick-style daily chart. */
    _buildCandleChart(canvas, prefs) {
        const a = this._eloAnalytics;
        const { candles, candleEma, candleTrends, candleTrendAnnotations,
                candleTrendLineData, candleTrendDirections, candleBollUpper, candleBollLower } = a;

        if (candles.length === 0) return;

        const showBoll = prefs.volatility;
        const showTrends = prefs.trends;
        const showSmoothed = prefs.smoothed ?? false;
        const { min: xMin, max: xMax } = this._getVisibleCandleRange(prefs.range);

        // Compute y-axis range from visible candles (+ Bollinger if active)
        const visibleCandles = candles.slice(xMin, xMax + 1);
        const allY = visibleCandles.flatMap(c => [c.low, c.high]);
        if (showBoll) {
            for (let i = xMin; i <= xMax; i++) {
                if (candleBollUpper[i] != null) allY.push(candleBollUpper[i]);
                if (candleBollLower[i] != null) allY.push(candleBollLower[i]);
            }
        }
        const yDataMin = Math.min(...allY);
        const yDataMax = Math.max(...allY);
        const yPad = Math.max(2, (yDataMax - yDataMin) * 0.08);

        const labels = candles.map(c => {
            const d = c.date;
            return `${d.getDate()}/${d.getMonth() + 1}`;
        });

        // Candle body: floating bar from open to close
        const bodyData = candles.map(c => [Math.min(c.open, c.close), Math.max(c.open, c.close)]);
        const bodyColors = candles.map(c => c.gain ? 'rgba(76, 175, 80, 0.75)' : 'rgba(244, 67, 54, 0.75)');
        const bodyBorders = candles.map(c => c.gain ? 'rgba(76, 175, 80, 1)' : 'rgba(244, 67, 54, 1)');

        // Wicks: custom annotations for high/low lines at each candle
        const wickAnnotations = {};
        candles.forEach((c, i) => {
            const bodyTop = Math.max(c.open, c.close);
            const bodyBottom = Math.min(c.open, c.close);
            if (c.high > bodyTop) {
                wickAnnotations[`wickHi${i}`] = {
                    type: 'line', xMin: i, xMax: i,
                    yMin: bodyTop, yMax: c.high,
                    borderColor: c.gain ? 'rgba(76, 175, 80, 0.6)' : 'rgba(244, 67, 54, 0.6)',
                    borderWidth: 1.5,
                };
            }
            if (c.low < bodyBottom) {
                wickAnnotations[`wickLo${i}`] = {
                    type: 'line', xMin: i, xMax: i,
                    yMin: c.low, yMax: bodyBottom,
                    borderColor: c.gain ? 'rgba(76, 175, 80, 0.6)' : 'rgba(244, 67, 54, 0.6)',
                    borderWidth: 1.5,
                };
            }
        });

        const datasets = [
            // 0: Bollinger upper
            {
                label: 'Bollinger Upper',
                data: showBoll ? candleBollUpper : candleBollUpper.map(() => null),
                borderColor: 'transparent', backgroundColor: 'transparent',
                pointRadius: 0, pointHitRadius: 0, borderWidth: 0,
                fill: false, order: 6, type: 'line',
            },
            // 1: Bollinger lower (fill)
            {
                label: 'Bollinger Lower',
                data: showBoll ? candleBollLower : candleBollLower.map(() => null),
                borderColor: 'transparent', backgroundColor: 'rgba(108, 171, 194, 0.10)',
                pointRadius: 0, pointHitRadius: 0, borderWidth: 0,
                fill: '-1', order: 5, type: 'line',
            },
            // 2: Candle bodies (floating bars)
            {
                label: 'Daily ELO',
                data: bodyData,
                backgroundColor: bodyColors,
                borderColor: bodyBorders,
                borderWidth: 1,
                borderSkipped: false,
                barPercentage: 0.85,
                categoryPercentage: 0.95,
                order: 4,
                type: 'bar',
            },
            // 3: EMA line
            {
                label: 'Moving Avg',
                data: showSmoothed ? candleEma : candleEma.map(() => null),
                borderColor: '#6cabc2', backgroundColor: '#6cabc2',
                pointRadius: 0, borderWidth: 2.5, tension: 0.3,
                pointHitRadius: 0, spanGaps: true, order: 3, type: 'line',
            },
            // 4: Trend lines
            {
                label: 'Trend',
                data: showTrends ? candleTrendLineData : candleTrendLineData.map(() => null),
                borderColor: 'rgba(255,255,255,0.3)', backgroundColor: 'transparent',
                pointRadius: 0, borderWidth: 2, borderDash: [6, 3],
                tension: 0, pointHitRadius: 0, spanGaps: false, order: 2, type: 'line',
                segment: {
                    borderColor: (ctx) => {
                        if (!ctx.p0 || !ctx.p1) return 'rgba(255,255,255,0.3)';
                        const dir = candleTrendDirections[ctx.p1DataIndex];
                        return dir === 'up'
                            ? 'rgba(76, 175, 80, 0.7)' : 'rgba(244, 67, 54, 0.7)';
                    },
                },
            },
        ];

        // Merge wick + trend annotations
        const annotations = { ...wickAnnotations };
        if (showTrends) Object.assign(annotations, candleTrendAnnotations);

        const chart = new Chart(canvas.getContext('2d'), {
            data: { labels, datasets },
            options: {
                animation: false,
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                scales: {
                    y: {
                        beginAtZero: false,
                        min: yDataMin - yPad,
                        max: yDataMax + yPad,
                        ticks: { color: '#ccc', maxTicksLimit: 6 },
                        grid: { color: 'rgba(170, 170, 170, 0.12)' },
                    },
                    x: {
                        min: xMin, max: xMax,
                        ticks: { color: '#ccc', maxTicksLimit: 14, maxRotation: 0 },
                        grid: { display: false },
                    },
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            title: (items) => {
                                if (!items.length) return '';
                                const idx = items[0].dataIndex;
                                return candles[idx]?.dateStr ?? '';
                            },
                            label: (item) => {
                                const lbl = item.dataset.label;
                                if (lbl === 'Bollinger Upper' || lbl === 'Bollinger Lower') return null;
                                if (lbl === 'Trend' && item.parsed.y === null) return null;
                                if (lbl === 'Daily ELO') {
                                    const c = candles[item.dataIndex];
                                    if (!c) return null;
                                    const delta = c.close - c.open;
                                    const sign = delta >= 0 ? '+' : '';
                                    return `Open: ${c.open}  Close: ${c.close}  (${sign}${delta})`;
                                }
                                const val = item.parsed.y;
                                if (val === null || val === undefined) return null;
                                return `${lbl}: ${Math.round(val)}`;
                            },
                        },
                        filter: (item) => {
                            const val = item.parsed.y;
                            return val !== null && val !== undefined;
                        },
                    },
                    annotation: { annotations },
                },
            },
        });

        this.chartInstances.push(chart);
        this._eloChartRef = chart;
    }

    /** Attach event listeners to ELO chart controls. Idempotent via AbortController. */
    _wireEloChartControls(prefs) {
        if (this._eloControlsAbort) this._eloControlsAbort.abort();
        const ac = new AbortController();
        this._eloControlsAbort = ac;
        const sig = { signal: ac.signal };

        const bollingerToggle = this.shadowRoot.getElementById('toggleBollinger');
        const trendsToggle = this.shadowRoot.getElementById('toggleTrends');
        const smoothedToggle = this.shadowRoot.getElementById('toggleSmoothed');
        const rangeSelect = this.shadowRoot.getElementById('eloRange');
        const modeSelect = this.shadowRoot.getElementById('eloMode');
        const chart = this._eloChartRef;
        const a = this._eloAnalytics;

        const persist = () => {
            const p = {
                volatility: bollingerToggle?.checked ?? true,
                trends: trendsToggle?.checked ?? true,
                smoothed: smoothedToggle?.checked ?? false,
                range: rangeSelect?.value ?? 'season',
                mode: modeSelect?.value ?? 'line',
            };
            saveEloChartPrefs(p);
            return p;
        };

        const rebuildChart = () => {
            const p = persist();
            const canvas = this.shadowRoot.getElementById('eloChart');
            if (canvas) this._renderCurrentEloMode(canvas, p);
        };

        // Volatility toggle: quick update without rebuild for line mode
        if (bollingerToggle) {
            bollingerToggle.addEventListener('change', () => {
                if (!chart) return rebuildChart();
                const show = bollingerToggle.checked;
                const isCandle = (modeSelect?.value ?? 'line') === 'candle';
                const upper = isCandle ? a.candleBollUpper : a.bollingerUpper;
                const lower = isCandle ? a.candleBollLower : a.bollingerLower;
                chart.data.datasets[0].data = show ? upper : upper.map(() => null);
                chart.data.datasets[1].data = show ? lower : lower.map(() => null);
                chart.update('none');
                persist();
            }, sig);
        }

        // Trends toggle: quick update
        if (trendsToggle) {
            trendsToggle.addEventListener('change', () => {
                if (!chart) return rebuildChart();
                const show = trendsToggle.checked;
                const isCandle = (modeSelect?.value ?? 'line') === 'candle';
                const tld = isCandle ? a.candleTrendLineData : a.trendLineData;
                const ta = isCandle ? a.candleTrendAnnotations : a.trendAnnotations;
                chart.data.datasets[4].data = show ? tld : tld.map(() => null);
                const annots = chart.options.plugins.annotation.annotations;
                if (!show) { for (const key of Object.keys(ta)) delete annots[key]; }
                else { Object.assign(annots, ta); }
                chart.update('none');
                persist();
            }, sig);
        }

        // Range and mode changes require a full rebuild to adjust x-axis
        if (rangeSelect) rangeSelect.addEventListener('change', rebuildChart, sig);
        if (modeSelect) modeSelect.addEventListener('change', rebuildChart, sig);
        // Smoothed toggle: rebuild needed (changes raw line thickness)
        if (smoothedToggle) smoothedToggle.addEventListener('change', rebuildChart, sig);
    }

    renderWinLossTable(ratios) {
        const container = this.shadowRoot.getElementById('winLossTableContainer');
        if (!container) return;
        container.innerHTML = '<h3>Win/Loss vs. Opponents</h3>';
        const table = this.createRatioTable(ratios, 'Opponent');
        container.appendChild(table);
        this.makeTableSortable(table);
    }

    renderTeammateWinLossTable(ratios) {
        const container = this.shadowRoot.getElementById('teammateWinLossTableContainer');
        if (!container) return;
        container.innerHTML = '<h3>Win/Loss with Teammates</h3>';
        const table = this.createRatioTable(ratios, 'Teammate');
        container.appendChild(table);
        this.makeTableSortable(table);
    }

    createRatioTable(ratios, entityHeader) {
        const table = document.createElement('table');
        table.className = 'stats-table';
        const thead = table.createTHead();
        const headerRow = thead.insertRow();
        const headers = [{ text: '#', type: 'string' }, { text: 'W', type: 'number' }, { text: 'L', type: 'number' }, { text: 'Ratio', type: 'number' }];
        headers.forEach(header => { const th = document.createElement('th'); th.textContent = header.text === '#' ? entityHeader : header.text; th.dataset.sortType = header.type; headerRow.appendChild(th); });
        const tbody = table.createTBody();
        const names = Object.keys(ratios).sort();
        if (names.length === 0) { const row = tbody.insertRow(); const cell = row.insertCell(); cell.colSpan = 4; cell.textContent = `No matches with ${entityHeader.toLowerCase()}s recorded.`; cell.style.textAlign = "center"; } else { names.forEach(name => { const stats = ratios[name]; const totalGames = stats.wins + stats.losses; const ratio = totalGames > 0 ? (stats.wins / totalGames * 100).toFixed(1) : 0; const row = tbody.insertRow(); row.insertCell().textContent = name; row.insertCell().textContent = stats.wins; row.insertCell().textContent = stats.losses; row.insertCell().textContent = `${ratio}%`; }); }
        return table;
    }

    makeTableSortable(table) {
        const headers = table.querySelectorAll('th');
        headers.forEach((header, index) => {
            header.addEventListener('click', () => {
                const tbody = table.querySelector('tbody');
                const rows = Array.from(tbody.querySelectorAll('tr'));
                const sortType = header.dataset.sortType;
                const isAsc = header.classList.contains('sort-asc');
                headers.forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
                const direction = isAsc ? 'desc' : 'asc';
                header.classList.add(`sort-${direction}`);
                const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
                rows.sort((rowA, rowB) => {
                    const cellA = rowA.cells[index].textContent.trim();
                    const cellB = rowB.cells[index].textContent.trim();
                    let valA, valB;
                    if (sortType === 'number') { valA = parseFloat(cellA.replace('%', '')); valB = parseFloat(cellB.replace('%', '')); } else { valA = cellA; valB = cellB; }
                    const modifier = direction === 'asc' ? 1 : -1;
                    if (sortType === 'number') { if (valA < valB) return -1 * modifier; if (valA > valB) return 1 * modifier; return 0; } else { return collator.compare(valA, valB) * modifier; }
                });
                tbody.append(...rows);
            });
        });
    }

    hideTooltip() {
        const tooltip = this.shadowRoot.querySelector('.tooltip.visible');
        if (tooltip) {
            tooltip.classList.remove('visible');
            // Important: remove the listener to avoid it firing unnecessarily later
            this.shadowRoot.querySelector('.modal-body-scrollable').removeEventListener('click', this.boundHideTooltip);
        }
    }

    renderEloFlowCharts(eloGainsLosses) {
        const container = this.shadowRoot.getElementById('eloFlowContainer');
        if (!container) return;
        container.innerHTML = '';
        const gains = Object.entries(eloGainsLosses).filter(([_, v]) => v > 0).sort((a, b) => b[1] - a[1]);
        const losses = Object.entries(eloGainsLosses).filter(([_, v]) => v < 0).map(([k, v]) => [k, -v]).sort((a, b) => b[1] - a[1]);
        const chartOptions = { responsive: true, plugins: { legend: { position: 'bottom', labels: { color: '#ccc' } } } };
        if (gains.length > 0) { const gainsWrapper = document.createElement('div'); gainsWrapper.className = 'pie-chart-wrapper'; gainsWrapper.innerHTML = '<h4>ELO Gained From</h4><canvas></canvas>'; container.appendChild(gainsWrapper); const chart = new Chart(gainsWrapper.querySelector('canvas').getContext('2d'), { type: 'pie', data: { labels: gains.map(([name, elo]) => `${name} (${Math.round(elo)})`), datasets: [{ data: gains.map(([_, elo]) => elo), backgroundColor: ['#4CAF50', '#8BC34A', '#CDDC39', '#009688', '#4DB6AC'] }] }, options: chartOptions }); this.chartInstances.push(chart); }
        if (losses.length > 0) { const lossesWrapper = document.createElement('div'); lossesWrapper.className = 'pie-chart-wrapper'; lossesWrapper.innerHTML = '<h4>ELO Lost To</h4><canvas></canvas>'; container.appendChild(lossesWrapper); const chart = new Chart(lossesWrapper.querySelector('canvas').getContext('2d'), { type: 'pie', data: { labels: losses.map(([name, elo]) => `${name} (${Math.round(elo)})`), datasets: [{ data: losses.map(([_, elo]) => elo), backgroundColor: ['#F44336', '#E91E63', '#9C27B0', '#FF5722', '#D32F2F'] }] }, options: chartOptions }); this.chartInstances.push(chart); }
        if (gains.length === 0 && losses.length === 0) { container.innerHTML = `<p style="text-align: center; width: 100%;">No ELO changes recorded.</p>`; }
    }

    /**
     * Performance Snapshot now displays two rows of three items each for clarity and space.
     * Row 1: Wins/Losses, Longest Win Streak, Streakyness
     * Row 2: All Time Highest ELO, Golden Ratio, Comeback Percentage
     */
    renderPerformanceSnapshot(streaks, streakyness, cachedStats) {
        const container = this.shadowRoot.getElementById('performanceContainer');
        if (!container) return;

        const streakynessScore = streakyness.score.toFixed(2);
        let streakynessClass = '';
        if (streakynessScore > 1.1) streakynessClass = 'streaky';
        if (streakynessScore < 0.9) streakynessClass = 'consistent';
        const highestElo = cachedStats?.highestElo ?? null;
        const goldenRatio = cachedStats?.goldenRatio ?? null;
        const goldenRatioDisplay = goldenRatio !== null ? (goldenRatio * 100).toFixed(0) + '%' : '-';
        const comebackPercentage = cachedStats?.comebackPercentage ?? null;
        const comebackDisplay = comebackPercentage !== null ? (comebackPercentage * 100).toFixed(0) + '%' : '-';

        container.innerHTML = `
            <div style="display: flex; justify-content: space-around; margin-bottom: 10px;">
                <div class="snapshot-item">
                    <h4>${streakyness.totalWins}/${streakyness.totalLosses}</h4>
                    <p>Wins/Losses</p>
                </div>
                <div class="snapshot-item">
                    <h4>${streaks.longestWinStreak}</h4>
                    <p>Longest Win Streak</p>
                </div>
                <div class="snapshot-item">
                    <h4 class="${streakynessClass}">${streakynessScore}</h4>
                    <p>
                        Streakyness
<!--                        <span class="info-icon">i</span>-->
                    </p>
<!--                    <span class="tooltip">A score > 1 suggests a "streaky" player. It compares the chance of two consecutive matches having the same result to the chance of two random matches of the player to have the same result.</span>-->
                </div>
            </div>
            <div style="display: flex; justify-content: space-around;">
                <div class="snapshot-item">
                    <h4>${highestElo !== null ? highestElo : '-'}</h4>
                    <p>Season Highest ELO</p>
                </div>
                <div class="snapshot-item">
                    <h4>${goldenRatioDisplay}</h4>
                    <p>
                        Golden Ratio
<!--                        <span class="info-icon">i</span>-->
                    </p>
<!--                    <span class="tooltip">Ratio of 5:4 wins to all 5:4 games (won or lost).</span>-->
                </div>
                <div class="snapshot-item">
                    <h4>${comebackDisplay}</h4>
                    <p>
                        Comeback Ratio
<!--                        <span class="info-icon">i</span>-->
                    </p>
<!--                    <span class="tooltip">Win-rate in games where player fell behind at any point.</span>-->
                </div>
            </div>
        `;

        // Add event listeners for info icons and tooltips
        const infoIcons = container.querySelectorAll('.info-icon');
        const tooltips = container.querySelectorAll('.tooltip');
        infoIcons.forEach((icon, idx) => {
            const tooltip = tooltips[idx];
            if (icon && tooltip) {
                icon.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const isVisible = tooltip.classList.toggle('visible');
                    if (isVisible) {
                        tooltip.style.width = '220px';
                        const scrollableBody = this.shadowRoot.querySelector('.modal-body-scrollable');
                        const iconRect = icon.getBoundingClientRect();
                        const bodyRect = scrollableBody.getBoundingClientRect();
                        const top = (iconRect.top - bodyRect.top) + scrollableBody.scrollTop - tooltip.offsetHeight - 10;
                        const left = (scrollableBody.offsetWidth / 2) - (tooltip.offsetWidth / 2);
                        tooltip.style.top = `${top}px`;
                        tooltip.style.left = `${left}px`;
                        this.shadowRoot.querySelector('.modal-body-scrollable').addEventListener('click', this.boundHideTooltip, { once: true });
                    }
                });
            }
        });
    }

    renderRecentMatches() {
        const container = this.shadowRoot.querySelector('.recent-matches-list');
        if (!container) return;
        container.innerHTML = '';
        const seasonMatches = filterMatchesBySeason(allMatches, getSelectedSeason());
        const relevantMatches = seasonMatches
            .filter(match => match.teamA.includes(this.playerName) || match.teamB.includes(this.playerName))
            .slice(0, 10);
        if (relevantMatches.length === 0) { container.innerHTML = `<li class="match-item">No recent matches found for this player.</li>`; return; }
        relevantMatches.forEach(match => {
            const li = document.createElement('li');
            li.className = 'match-item';
            const isPlayerInTeamA = match.teamA.includes(this.playerName);
            const playerWon = (isPlayerInTeamA && match.winner === 'A') || (!isPlayerInTeamA && match.winner === 'B');
            li.classList.add(playerWon ? 'win' : 'loss');
            const teamAPlayers = match.teamA.map(player => `<span style="color: #ce848c;">${player}</span>`).join(` <span style="color: #ce848c;"> & </span> `);
            const teamBPlayers = match.teamB.map(player => `<span style="color: #6cabc2;">${player}</span>`).join(` <span style="color: #6cabc2;"> & </span> `);
            const playerGoals = isPlayerInTeamA ? (match.goalsA ?? '-') : (match.goalsB ?? '-');
            const opponentGoals = isPlayerInTeamA ? (match.goalsB ?? '-') : (match.goalsA ?? '-');
            const playerTeamHtml = isPlayerInTeamA ? teamAPlayers : teamBPlayers;
            const opponentTeamHtml = isPlayerInTeamA ? teamBPlayers : teamAPlayers;
            const seasonDelta = getSeasonMatchDelta(match);
            const deltaValue = seasonDelta ?? 0;
            const changeSpanText = match.ranked === false
                ? `<span style="color: gray">(unranked)</span>`
                : (playerWon
                    ? `<span style="color: #86e086">▲ ${Math.round(deltaValue)}</span>`
                    : `<span style="color: #ff7b7b">▼ ${Math.round(Math.abs(deltaValue))}</span>`);
            // Render match info and ELO change in a flex row
            const infoRow = document.createElement('div');
            infoRow.className = 'match-info-row';
            infoRow.style.display = 'flex';
            infoRow.style.alignItems = 'center';
            infoRow.style.justifyContent = 'space-between';
            const tournamentTag = match.tournamentGameName
                ? `<span style="font-size: 0.7em; color: #d4a843; margin-left: 6px; white-space: nowrap;">🏆 ${match.tournamentGameName}</span>`
                : '';
            infoRow.innerHTML = ` <div class="match-info"> <span class="team-display">${playerTeamHtml}</span> <strong class="match-score">${playerGoals}:${opponentGoals}</strong> <span class="team-display">${opponentTeamHtml}</span>${tournamentTag} </div> <div class="elo-change"> ${changeSpanText} </div> `;
            li.appendChild(infoRow);
            // Add timeline for live matches below the info row
            if (Array.isArray(match.goalLog) && match.goalLog.length > 0) {
                const timelineWithLabel = createTimelineWithLabel(match.goalLog);
                if (timelineWithLabel) {
                    timelineWithLabel.style.marginTop = '4px';
                    timelineWithLabel.style.width = '100%';
                    li.appendChild(timelineWithLabel);
                }
            }
            container.appendChild(li);
        });
    }

    renderGoalStats(goalStats) {
        // Defensive: support both camelCase and snakeCase for compatibility
        const resultHistogram = goalStats.resultHistogram ?? goalStats.histogram ?? {};
        const goalsFor = goalStats.goalsFor ?? 0;
        const goalsAgainst = goalStats.goalsAgainst ?? 0;
        const allTimeGoalsEl = this.shadowRoot.getElementById('allTimeGoals');
        if (allTimeGoalsEl) {
            allTimeGoalsEl.textContent = `${goalsFor}:${goalsAgainst}`;
        }
        const canvas = this.shadowRoot.getElementById('goalHistogramChart');
        if (!canvas) return;
        // Only show results where one team has MAX_GOALS and the other has 0..(MAX_GOALS-1)
        const lossLabels = [];
        const winLabels = [];
        for (let i = 0; i < MAX_GOALS; i++) {
            lossLabels.push(`${i}:${MAX_GOALS}`); // Player's team lost
            winLabels.unshift(`${MAX_GOALS}:${i}`); // Player's team won (unshift for descending order)
        }
        const labels = [...lossLabels, ...winLabels];
        const data = labels.map(label => resultHistogram[label] || 0);
        // Destroy any existing chart instance for this canvas
        const existingChart = this.chartInstances.find(chart => chart.canvas === canvas);
        if (existingChart) {
            existingChart.destroy();
            this.chartInstances = this.chartInstances.filter(chart => chart !== existingChart);
        }
        // Create the bar chart
        const ctx = canvas.getContext('2d');
        const chart = new Chart(ctx,
            {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Match Results',
                    data: data,
                    backgroundColor: '#6cabc2',
                    borderColor: '#4c8f99',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: 'Result',
                            color: '#ccc',
                            font: {size: 14, weight: 'bold'}
                        },
                        ticks: {color: '#ccc', font: {size: 12}},
                        grid: {color: 'rgba(170, 170, 170, 0.2)'},
                    },
                    y: {
                        title: {
                            display: true,
                            text: 'Count',
                            color: '#ccc',
                            font: {size: 14, weight: 'bold'}
                        },
                        beginAtZero: true,
                        ticks: {color: '#ccc', stepSize: 1},
                        grid: {color: 'rgba(170, 170, 170, 0.2)'}
                    }
                },
                plugins: {
                    legend: {display: false}
                }
            }}
        );
        this.chartInstances.push(chart);
    }

    /**
     * Renders average time between goals for player's team and opponents in mm:ss format, using snapshot layout.
     * @param {{ avgTimePerTeamGoal: number|null, avgTimePerOpponentGoal: number|null }} stats
     */
    renderGoalTimingStats(stats) {
        const container = this.shadowRoot.getElementById('goalTimingStatsContainer');
        if (!container) return;
        // Helper to format ms to mm:ss
        function formatMsToMinSec(ms) {
            if (ms === null) return 'N/A';
            const totalSeconds = Math.round(ms / 1000);
            const minutes = Math.floor(totalSeconds / 60);
            const seconds = totalSeconds % 60;
            return `${minutes}:${seconds.toString().padStart(2, '0')}`;
        }
        container.innerHTML = `
            <div style="display: flex; justify-content: space-around; text-align: center;">
                <div class="snapshot-item">
                    <h4>${formatMsToMinSec(stats.avgTimePerTeamGoal)}</h4>
                    <p>Avg Time Between Team Goals</p>
                </div>
                <div class="snapshot-item">
                    <h4>${formatMsToMinSec(stats.avgTimePerOpponentGoal)}</h4>
                    <p>Avg Time Between Opponent Goals</p>
                </div>
            </div>
        `;
    }
    close() {
        this.hideTooltip();
        if (this._eloControlsAbort) this._eloControlsAbort.abort();
        this.parentNode.classList.remove('visible');
        this.parentNode.innerHTML = '';
        this.chartInstances.forEach(chart => chart.destroy());
        this.chartInstances = [];

        if (history.state?.modal === 'playerStatsModalOpen') {
            history.back();
        }
    }
}


export function showPlayerStats(playerName) {
    const backdrop = document.getElementById('playerStatsBackdrop');
    if (!backdrop) { console.error("playerStatsBackdrop not found."); return; }
    backdrop.innerHTML = '';
    backdrop.classList.add('visible');
    const component = document.createElement('player-stats-component');
    component.setAttribute('player-name', playerName);
    backdrop.appendChild(component);
    if (history.state?.modal !== 'playerStatsModalOpen') {
        history.pushState({ modal: 'playerStatsModalOpen' }, '');
    }
}

window.addEventListener('popstate', (event) => {
    const backdrop = document.getElementById('playerStatsBackdrop');
    const component = backdrop?.querySelector('player-stats-component');
    if (component && (!event.state || event.state.modal !== 'playerStatsModalOpen')) {
        component.close();
    }
});

customElements.define('player-stats-component', PlayerStatsComponent);
