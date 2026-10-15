// src/emoji-stats.js
// Emoji badge summaries from the stats cache's emojiTally (selected season), and the
// player page's "Emoji collection" grid. DOM-free apart from the render function, so
// node tests can import it. The main page section lives in emoji-stats-display.js.

import { BADGE_INFO } from './constants.js';

const EMOJIS = Object.keys(BADGE_INFO);

export const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function formatBadgeDate(timestamp) {
    return new Date(timestamp).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: '2-digit' });
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
