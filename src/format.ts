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

/**
 * One fixed-width blame column (author + date), so the code after it stays
 * aligned. Padded on both sides because blameHeat tints the column's
 * background, and text flush against the edge of that band looks cramped.
 */
export function annotationText(blame: BlameInfo): string {
    const body = blame.isUncommitted
        ? pad('You', 14) + pad('uncommitted', 11)
        : pad(blame.author, 14) + pad(isoDate(blame.date), 11);
    return NBSP + body + NBSP;
}

type Rgb = readonly [number, number, number];

/**
 * The age ramp, JetBrains' scheme: the newest commit in the file is green, the
 * oldest a muted mauve, and the middle passes through a neutral slate so the
 * two ends read as opposites rather than as one muddy gradient.
 */
const NEWEST: Rgb = [61, 122, 51];
const MIDDLE: Rgb = [95, 99, 110];
const OLDEST: Rgb = [122, 74, 96];

/**
 * The band is a tint rather than a solid colour, so it composites over
 * whatever the editor background is and works on light and dark themes alike.
 * The annotation text keeps the theme's own colour on top of it.
 */
const BAND_ALPHA = 0.35;

function mix(from: Rgb, to: Rgb, t: number): Rgb {
    return [0, 1, 2].map(i => Math.round(from[i] + (to[i] - from[i]) * t)) as unknown as Rgb;
}

/**
 * A background band per line, coloured by how recent that line's commit is, so
 * recency reads at a glance and consecutive lines from one commit form a block.
 * `undefined` marks an uncommitted line, which the caller paints itself.
 *
 * Commits are ranked against the others *in this file*, not by absolute age.
 * An old file would otherwise annotate as one flat wash, and the point of the
 * shading is to separate the commits you are actually looking at.
 */
export function blameHeat(blames: (BlameInfo | undefined)[]): (string | undefined)[] {
    const dateOf = new Map<string, number>();
    for (const b of blames) {
        if (b && !b.isUncommitted) { dateOf.set(b.hash, b.date); }
    }
    const rank = new Map(
        [...dateOf.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([hash], i) => [hash, i] as const)
    );
    // One distinct commit is the newest one, so it should not come out grey.
    const oldest = Math.max(rank.size - 1, 1);

    return blames.map(b => {
        if (!b || b.isUncommitted) { return undefined; }
        const age = (rank.get(b.hash) ?? 0) / oldest;
        const [r, g, bl] = age <= 0.5
            ? mix(NEWEST, MIDDLE, age * 2)
            : mix(MIDDLE, OLDEST, (age - 0.5) * 2);
        return `rgba(${r}, ${g}, ${bl}, ${BAND_ALPHA})`;
    });
}
