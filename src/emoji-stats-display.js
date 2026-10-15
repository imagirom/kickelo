// src/emoji-stats-display.js
// "Emoji stats" on the main page: a rarest-first list and a player × emoji count table
// for the selected season. Follows the leaderboard's season and "show inactive players"
// filters like the ELO graph.

import { BADGE_INFO } from './constants.js';
import { getAllCachedStats } from './stats-cache-service.js';
import { isPlayerVisible } from './leaderboard-display.js';
import { summarizeEmojiTallies, rarestFirst, formatBadgeDate, escapeHtml } from './emoji-stats.js';

const EMOJIS = Object.keys(BADGE_INFO);

function renderEmojiStats(container) {
    const allStats = getAllCachedStats() || {};
    const visible = Object.fromEntries(Object.entries(allStats).filter(([, stats]) => isPlayerVisible(stats)));
    const summary = summarizeEmojiTallies(visible);

    const rows = Object.entries(visible)
        .map(([name, stats]) => {
            const tally = stats.emojiTally || {};
            const total = EMOJIS.reduce((sum, emoji) => sum + (tally[emoji]?.count || 0), 0);
            return { name, tally, total };
        })
        .filter((row) => row.total > 0)
        .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

    if (rows.length === 0) {
        container.innerHTML = '<p class="emoji-stats-empty">No emojis earned in this season yet.</p>';
        return;
    }

    const rarest = rarestFirst(summary).slice(0, 5);
    const rarestHtml = rarest.map((emoji) => {
        const s = summary[emoji];
        const info = BADGE_INFO[emoji];
        return `<li title="${escapeHtml(`${info.name}: ${info.rule}`)}">
            <span class="emoji-glyph">${emoji}</span>
            <span><strong>×${s.total}</strong> · ${s.holders} ${s.holders === 1 ? 'holder' : 'holders'}
            · first ${escapeHtml(s.first.player)} (${formatBadgeDate(s.first.at)})
            · top ${escapeHtml(s.top.player)} ×${s.top.count}</span>
        </li>`;
    }).join('');

    const columnMax = Object.fromEntries(EMOJIS.map((emoji) => [emoji, Math.max(0, ...rows.map((row) => row.tally[emoji]?.count || 0))]));
    const cell = (count, max) => {
        if (!count) return '<td class="zero">·</td>';
        const alpha = (0.15 + 0.65 * (count / max)).toFixed(2);
        return `<td style="background-color: rgba(108, 171, 194, ${alpha})">${count}</td>`;
    };
    const headerCells = EMOJIS.map((emoji) =>
        `<th title="${escapeHtml(`${BADGE_INFO[emoji].name}: ${BADGE_INFO[emoji].rule}`)}">${emoji}</th>`).join('');
    const bodyRows = rows.map((row) => `<tr>
            <th scope="row">${escapeHtml(row.name)}</th>
            ${EMOJIS.map((emoji) => cell(row.tally[emoji]?.count || 0, columnMax[emoji])).join('')}
            <td class="total">${row.total}</td>
        </tr>`).join('');
    const grandTotal = rows.reduce((sum, row) => sum + row.total, 0);
    const totalsRow = `<tr class="totals">
            <th scope="row">Total</th>
            ${EMOJIS.map((emoji) => `<td>${summary[emoji].total || '·'}</td>`).join('')}
            <td class="total">${grandTotal}</td>
        </tr>`;

    container.innerHTML = `
        <h3 class="emoji-stats-subheading">Rarest</h3>
        <ul class="emoji-rarest-list">${rarestHtml}</ul>
        <div class="emoji-stats-scroll">
            <table class="emoji-stats-table">
                <thead><tr><th scope="col">Player</th>${headerCells}<th scope="col" title="All emojis (points badges count their points)">Σ</th></tr></thead>
                <tbody>${bodyRows}</tbody>
                <tfoot>${totalsRow}</tfoot>
            </table>
        </div>`;
}

export function initializeEmojiStats() {
    const container = document.getElementById('emojiStats');
    if (!container) return;

    const update = () => renderEmojiStats(container);
    update();
    window.addEventListener('stats-cache-updated', update);
    window.addEventListener('inactive-filter-changed', update);
}
