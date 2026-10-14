// src/elo-overview-chart.js
// Line chart of every visible player's ELO for the selected season, styled like the
// player page's ELO Trajectory (line mode): one x-step per match, day separators,
// optional smoothing and an active-day range selector.
// Follows the leaderboard's season and "show inactive players" filters.

import Chart, { Interaction } from 'chart.js/auto';
import { getAllCachedStats } from './stats-cache-service.js';
import { isPlayerVisible } from './leaderboard-display.js';
import { STARTING_ELO } from './constants.js';
import { computeEMA, findDayBoundaries } from './elo-chart-utils.js';

const DIMMED_ALPHA = 0.12;
const LINE_WIDTH = 2;
const HIGHLIGHT_WIDTH = 3.2;
const GOLDEN_GOAL_COLOR = '#ffd900c7';

// --- Persistent chart preferences ---
const PREFS_KEY = 'kickelo_eloOverviewPrefs';
function loadPrefs() {
    try {
        const raw = localStorage.getItem(PREFS_KEY);
        if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return { range: 'season', smoothed: false };
}
function savePrefs(prefs) {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
}

let chart = null;
let highlighted = null; // dataset index currently emphasized, or null

/** Evenly spaced hues, offset so neighbours in the ranking get contrasting colors. */
function playerColor(index, total) {
    const hue = Math.round((index * 360 * 0.618) % 360);
    const lightness = total > 12 && index % 2 ? 72 : 62;
    return (alpha = 1) => `hsla(${hue}, 70%, ${lightness}%, ${alpha})`;
}

/**
 * Put every visible player on a shared match axis: x = 0 is the season start,
 * then one step per distinct match timestamp. Each player only gets points at
 * their own matches (plus STARTING_ELO right before their first one), so lines
 * run straight from one of their games to the next. Data stays sparse - a dense
 * players x matches grid made every redraw ~10x slower on a full season.
 */
function buildChartData(smoothed) {
    const allStats = getAllCachedStats() || {};
    const players = Object.entries(allStats)
        .filter(([, stats]) => isPlayerVisible(stats))
        .map(([name, stats]) => ({ name, trajectory: stats.eloTrajectory }))
        // Sort by current ELO so legend order matches the leaderboard
        .sort((a, b) => b.trajectory.at(-1).elo - a.trajectory.at(-1).elo);

    const matchTimestamps = [...new Set(players.flatMap(p => p.trajectory.map(pt => pt.timestamp)))]
        .sort((a, b) => a - b);
    const timestamps = [matchTimestamps[0], ...matchTimestamps];
    const xOf = new Map(matchTimestamps.map((ts, i) => [ts, i + 1]));

    const datasets = players.map(({ name, trajectory }, i) => {
        const color = playerColor(i, players.length);
        const xs = trajectory.map(pt => xOf.get(pt.timestamp));
        const rawValues = [STARTING_ELO, ...trajectory.map(pt => pt.elo)];
        const span = Math.max(6, Math.min(14, Math.ceil(rawValues.length / 4)));
        const values = smoothed ? computeEMA(rawValues, span) : rawValues;
        const data = [xs[0] - 1, ...xs].map((x, k) => ({ x, y: values[k] }));
        const pointRadius = [0, ...trajectory.map(pt => (pt.isGoldenGoalWin && !smoothed ? 1.5 : 0))];

        // Lookup for the "match" interaction mode: x -> data index of a match this player played
        const indexByX = new Map(xs.map((x, k) => [x, k + 1]));
        if (xs[0] === 1) indexByX.set(0, 0);

        return {
            label: name,
            data,
            _color: color,
            _indexByX: indexByX,
            borderColor: color(),
            backgroundColor: color(),
            borderWidth: LINE_WIDTH,
            pointRadius,
            pointBackgroundColor: GOLDEN_GOAL_COLOR,
            pointBorderColor: GOLDEN_GOAL_COLOR,
            pointHoverBackgroundColor: color(),
            pointHoverBorderColor: color(),
            pointHoverRadius: 3,
            pointHitRadius: 6,
            tension: smoothed ? 0.35 : 0,
        };
    });

    return { timestamps, datasets };
}

/**
 * Interaction mode: the match closest to the cursor (by x), with every player who played in it.
 * Replaces Chart.js' "index" mode, which assumes all datasets share the same data indices.
 */
Interaction.modes.eloMatch = function (c, event, options, useFinalPosition) {
    const nearest = Interaction.modes.nearest(c, event, { axis: 'x', intersect: false }, useFinalPosition);
    if (!nearest.length) return [];
    const { datasetIndex, index } = nearest[0];
    const x = c.data.datasets[datasetIndex].data[index].x;
    const items = [];
    c.data.datasets.forEach((ds, i) => {
        if (!c.isDatasetVisible(i)) return;
        const dataIndex = ds._indexByX?.get(x);
        if (dataIndex !== undefined) {
            items.push({ element: c.getDatasetMeta(i).data[dataIndex], datasetIndex: i, index: dataIndex });
        }
    });
    return items;
};

/** Index range for the selected range option, counted in active (match) days. */
function getVisibleRange(timestamps, range) {
    const total = timestamps.length;
    if (range === 'season' || total === 0) return { min: 0, max: total - 1 };
    const numDays = range === '5d' ? 5 : 20;
    const dayStarts = [1, ...findDayBoundaries(timestamps.slice(1)).map(i => i + 1)];
    const firstDay = dayStarts[Math.max(0, dayStarts.length - numDays)];
    // Include one point before the first visible day for context
    return { min: Math.max(0, firstDay - 1), max: total - 1 };
}

/**
 * Dashed vertical lines at day boundaries (same look as the player page's day annotations).
 * Drawn directly instead of via chartjs-plugin-annotation: a season has hundreds of match
 * days, and hundreds of annotation objects made every redraw (including hover) ~10x slower.
 */
const dayLinesPlugin = {
    id: 'eloDayLines',
    beforeDatasetsDraw(c, args, options) {
        const { ctx, chartArea, scales: { x } } = c;
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        for (const idx of options.indices || []) {
            if (idx < x.min || idx > x.max) continue;
            const px = Math.round(x.getPixelForValue(idx)) + 0.5;
            ctx.moveTo(px, chartArea.top);
            ctx.lineTo(px, chartArea.bottom);
        }
        ctx.stroke();
        ctx.restore();
    },
};

function applyHighlight() {
    if (!chart) return;
    chart.data.datasets.forEach((ds, i) => {
        const dim = highlighted !== null && i !== highlighted;
        ds.borderColor = ds._color(dim ? DIMMED_ALPHA : 1);
        ds.backgroundColor = ds.borderColor;
        ds.borderWidth = highlighted === i ? HIGHLIGHT_WIDTH : LINE_WIDTH;
    });
    chart.update('none');
}

function setHighlight(index) {
    if (highlighted === index) return;
    highlighted = index;
    applyHighlight();
}

function render(container, emptyEl, prefs) {
    const canvas = container.querySelector('canvas');
    if (chart) { chart.destroy(); chart = null; }
    highlighted = null;

    const { timestamps, datasets } = buildChartData(prefs.smoothed);
    if (datasets.length === 0) {
        container.style.display = 'none';
        emptyEl.style.display = '';
        return;
    }
    container.style.display = '';
    emptyEl.style.display = 'none';

    const { min: xMin, max: xMax } = getVisibleRange(timestamps, prefs.range);
    const dayBoundaries = findDayBoundaries(timestamps.slice(1)).map(i => i + 1);

    chart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: { datasets },
        plugins: [dayLinesPlugin],
        options: {
            animation: false,
            responsive: true,
            maintainAspectRatio: false,
            parsing: false,
            normalized: true,
            // Hovering shows everyone who played in the nearest match
            interaction: { mode: 'eloMatch', intersect: false },
            scales: {
                y: {
                    ticks: { color: '#ccc', maxTicksLimit: 6 },
                    grid: { color: 'rgba(170, 170, 170, 0.12)' },
                },
                x: {
                    type: 'linear',
                    min: xMin, max: xMax,
                    ticks: {
                        color: '#ccc', maxTicksLimit: 10, maxRotation: 0, precision: 0,
                        callback: (value) => {
                            const ts = timestamps[Math.round(value)];
                            return ts === undefined ? '' : new Date(ts).toLocaleDateString();
                        },
                    },
                    grid: { display: false },
                },
            },
            // Emphasize whichever player in the hovered match is closest to the cursor
            onHover: (event, elements) => {
                if (!elements.length) return setHighlight(null);
                const closest = elements.reduce((best, el) =>
                    Math.abs(el.element.y - event.y) < Math.abs(best.element.y - event.y) ? el : best);
                setHighlight(closest.datasetIndex);
            },
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: '#ccc', boxWidth: 10, boxHeight: 10, padding: 8, font: { size: 11 } },
                    onHover: (event, item) => setHighlight(item.datasetIndex),
                    onLeave: () => setHighlight(null),
                },
                tooltip: {
                    itemSort: (a, b) => b.parsed.y - a.parsed.y,
                    callbacks: {
                        title: (items) => items.length && items[0].parsed.x > 0
                            ? new Date(timestamps[items[0].parsed.x]).toLocaleString()
                            : 'Season start',
                        label: (item) => `${item.dataset.label}: ${Math.round(item.parsed.y)}`,
                        labelColor: (item) => {
                            const color = item.dataset._color();
                            return { borderColor: color, backgroundColor: color };
                        },
                    },
                },
                eloDayLines: { indices: dayBoundaries },
            },
        },
    });
}

export function initializeEloOverviewChart() {
    const container = document.getElementById('eloOverviewContainer');
    const emptyEl = document.getElementById('eloOverviewEmpty');
    const rangeSelect = document.getElementById('eloOverviewRange');
    const smoothedToggle = document.getElementById('eloOverviewSmoothed');
    if (!container || !emptyEl) return;

    const prefs = loadPrefs();
    if (rangeSelect) rangeSelect.value = prefs.range;
    if (smoothedToggle) smoothedToggle.checked = prefs.smoothed;

    const update = () => render(container, emptyEl, prefs);
    const onControlChange = () => {
        prefs.range = rangeSelect?.value ?? 'season';
        prefs.smoothed = smoothedToggle?.checked ?? false;
        savePrefs(prefs);
        update();
    };
    rangeSelect?.addEventListener('change', onControlChange);
    smoothedToggle?.addEventListener('change', onControlChange);
    container.querySelector('canvas').addEventListener('mouseleave', () => setHighlight(null));

    update();
    window.addEventListener('stats-cache-updated', update);
    window.addEventListener('inactive-filter-changed', update);
}
