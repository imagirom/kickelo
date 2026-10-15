// src/emoji-stats.js
// Emoji badge summaries from the stats cache's emojiTally (selected season), the leaderboard's
// "Emojis" / "Longest streaks" rankings, and the player page's "Emoji collection" grid.
// DOM-free apart from the render function, so node tests can import it.

import { BADGE_INFO } from './constants.js';

export const EMOJIS = Object.keys(BADGE_INFO);
export const STREAK_EMOJIS = EMOJIS.filter((emoji) => BADGE_INFO[emoji].kind === 'streak');

/** Sum of a tally's counts (points badges add their points). */
export const emojiTotal = (tally = {}) => EMOJIS.reduce((sum, emoji) => sum + (tally[emoji]?.count || 0), 0);

/**
 * Leaderboard ranking by an emoji value: players with value > 0, highest first, ties by name.
 * valueOf(stats) -> number. Returns { rows: [{ name, value }], without: players left out (value 0) }.
 */
export function rankPlayers(statsByPlayer, valueOf) {
    const rows = Object.entries(statsByPlayer)
        .map(([name, stats]) => ({ name, value: valueOf(stats) || 0 }))
        .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
    const ranked = rows.filter((row) => row.value > 0);
    return { rows: ranked, without: rows.length - ranked.length };
}

/**
 * The chip shown as selected: the saved one if it is a choice this season, else the view's default
 * (All = null for "emojis", 🔥 for "streaks"). The saved preference itself is left untouched.
 */
export const pickChip = (view, saved, choices) =>
    (choices.includes(saved) ? saved : view === 'streaks' ? STREAK_EMOJIS[0] : null);

/** Value for the "Emojis" view: the count of one emoji, or the total when emoji is null. */
export const emojiValue = (stats, emoji) => (emoji ? stats?.emojiTally?.[emoji]?.count : emojiTotal(stats?.emojiTally));

/** Value for the "Longest streaks" view: the longest run of that streak kind in the season. */
export const longestStreakValue = (stats, emoji) => stats?.longestEmojiStreaks?.[emoji] || 0;

/** "Rarest: 🧊 ×1 (Anna) · 🐢 ×2 · 🏖️ ×3" (holder named when there is only one), '' if none earned. */
export function rarestLine(summary, limit = 3) {
    const parts = rarestFirst(summary).slice(0, limit).map((emoji) => {
        const s = summary[emoji];
        return `${emoji} ×${s.total}${s.holders === 1 ? ` (${s.first.player})` : ''}`;
    });
    return parts.length ? `Rarest: ${parts.join(' · ')}` : '';
}

export const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** "Sep 25" this year, "Sep 25, 2025" for earlier years (a 2-digit year read like a day). */
export function formatBadgeDate(timestamp) {
    const date = new Date(timestamp);
    const thisYear = date.getFullYear() === new Date().getFullYear();
    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(thisYear ? {} : { year: 'numeric' }) });
}

/**
 * Per-emoji summary over the given players' tallies.
 * @param {Object<string, Object>} statsByPlayer - player name -> cached stats (with emojiTally)
 * @returns {Object<string, { total, holders, first: {player, at}|null, top: {player, count}|null }>}
 */
export function summarizeEmojiTallies(statsByPlayer) {
    const summary = Object.fromEntries(EMOJIS.map((emoji) => [emoji, { total: 0, holders: 0, first: null, top: null }]));
    for (const [player, stats] of Object.entries(statsByPlayer)) {
        for (const [emoji, entry] of Object.entries(stats?.emojiTally || {})) {
            const s = summary[emoji];
            if (!s) continue;
            s.total += entry.count;
            s.holders++;
            if (!s.first || entry.firstAt < s.first.at) s.first = { player, at: entry.firstAt };
            if (!s.top || entry.count > s.top.count) s.top = { player, count: entry.count };
        }
    }
    return summary;
}

/** Earned emojis, rarest (lowest season total) first. */
export function rarestFirst(summary) {
    return EMOJIS.filter((emoji) => summary[emoji].total > 0)
        .sort((a, b) => summary[a].total - summary[b].total || summary[a].holders - summary[b].holders);
}

function describe(emoji, entry) {
    const info = BADGE_INFO[emoji];
    let text = `${emoji} ${info.name}: ${info.rule}`;
    if (entry) {
        text += ` · ×${entry.count}`;
        if (entry.maxLength) text += ` (longest ${entry.maxLength})`;
        text += ` · first ${formatBadgeDate(entry.firstAt)}`;
    } else {
        text += ' · not collected yet';
    }
    return text;
}

/**
 * Renders a player's emoji collection into `container` (works inside a shadow root:
 * the host supplies the .emoji-collection styles). summary: summarizeEmojiTallies over all players.
 */
export function renderEmojiCollection(container, tally = {}, summary = {}) {
    const collected = EMOJIS.filter((emoji) => tally[emoji]);
    const rarest = collected.reduce((best, emoji) =>
        (!best || (summary[emoji]?.total ?? 0) < (summary[best]?.total ?? 0) ? emoji : best), null);
    const header = `${collected.length}/${EMOJIS.length} collected${rarest ? ` · rarest ${rarest}` : ''}`;

    const cells = EMOJIS.map((emoji) => {
        const entry = tally[emoji];
        const info = BADGE_INFO[emoji];
        const count = entry ? `×${entry.count}${entry.maxLength ? ` <span class="emoji-max">max ${entry.maxLength}</span>` : ''}` : '';
        return `<button type="button" class="emoji-cell${entry ? '' : ' locked'}" data-emoji="${emoji}" title="${escapeHtml(describe(emoji, entry))}">
            <span class="emoji-glyph">${emoji}</span>
            <span class="emoji-count">${count || escapeHtml(info.name)}</span>
            <span class="emoji-date">${entry ? formatBadgeDate(entry.firstAt) : ''}</span>
        </button>`;
    }).join('');

    container.innerHTML = `
        <p class="emoji-collection-header">${header}</p>
        <div class="emoji-collection-grid">${cells}</div>
        <p class="emoji-detail">Tap an emoji to see how it is earned.</p>`;

    const detail = container.querySelector('.emoji-detail');
    container.querySelectorAll('.emoji-cell').forEach((cell) => {
        cell.addEventListener('click', () => {
            const emoji = cell.dataset.emoji;
            detail.textContent = describe(emoji, tally[emoji]);
            container.querySelectorAll('.emoji-cell.selected').forEach((el) => el.classList.remove('selected'));
            cell.classList.add('selected');
        });
    });
}
