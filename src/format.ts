// Pure formatting helpers. No vscode import, so the self-check can require them.

import { BlameInfo } from './git';

export function timeAgo(unixSeconds: number): string {
    const s = Math.floor(Date.now() / 1000) - unixSeconds;
    if (s < 60) { return 'just now'; }
    const units: [number, string][] = [
        [60, 'minute'], [24, 'hour'], [30, 'day'], [12, 'month'], [Infinity, 'year']
    ];
    let value = Math.floor(s / 60);
    let name = 'minute';
    for (const [div, unit] of units) {
        name = unit;
        if (value < div) { break; }
        value = Math.floor(value / div);
    }
    return `${value} ${name}${value === 1 ? '' : 's'} ago`;
}

const NBSP = ' ';

/** Pad to `width` with non-breaking spaces; plain spaces collapse in decorations. */
function pad(text: string, width: number): string {
    const clipped = text.length > width ? `${text.substring(0, width - 1)}…` : text;
    return clipped + NBSP.repeat(width - clipped.length);
}

function isoDate(unixSeconds: number): string {
    return new Date(unixSeconds * 1000).toISOString().substring(0, 10);
}

/** One fixed-width blame column (author + date), so the code after it stays aligned. */
export function annotationText(blame: BlameInfo): string {
    return blame.isUncommitted
        ? pad('You', 14) + pad('uncommitted', 11)
        : pad(blame.author, 14) + pad(isoDate(blame.date), 11);
}
