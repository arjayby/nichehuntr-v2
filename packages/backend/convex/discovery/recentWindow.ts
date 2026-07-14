/**
 * The window that makes a Video "recent" — the one slice of a Channel's life that
 * everything downstream answers for.
 *
 * It lives alone in its own module because two things now measure against it, and they
 * are not free to disagree. Every Signal that CONTEXT.md defines over "a recent window"
 * — Momentum, Upload Cadence, Outlier Ratio, both Form Shares — reads this window, and
 * so does the Entry Bar, which admits a Channel on the views it earned inside it. A
 * second copy of this number would let the index admit a Channel on one definition of
 * "recent" and then score it on another.
 */

export const DAY = 24 * 60 * 60 * 1000;

/** How far back "recent" reaches. */
export const RECENT_WINDOW_DAYS = 30;
