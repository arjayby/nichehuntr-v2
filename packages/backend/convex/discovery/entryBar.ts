/**
 * The Entry Bar decides what is allowed into the index: a minimum of recent views,
 * with **no subscriber requirement at all**. Subscribers are a lagging indicator —
 * the residue of past success — and recent views are a leading one. A 300-subscriber
 * Channel with 800k views this month is admitted; a 50,000-subscriber Channel dormant
 * for a year is not.
 *
 * The same rule garbage-collects. A Channel that goes quiet stops earning recent
 * views, falls below the bar and ages out of the index on its own, with no separate
 * eviction rule to keep in step with this one.
 *
 * Accepted consequence: a dormant Channel with a strong back-catalogue disappears.
 * We are a hunting tool, not an archive.
 */

import { DAY, RECENT_WINDOW_DAYS } from "./recentWindow";

/**
 * The bar itself: the index's appetite, in one number. Every admission and every age-out
 * in the codebase reads it, and nothing else sets it.
 *
 * The window it is measured over is not ours to choose — it is the Discovery-wide
 * `RECENT_WINDOW_DAYS`, the same "recent" a Channel's Signals are computed against, so
 * that a Channel cannot be admitted on one definition of recent and then scored on
 * another.
 */
export const MINIMUM_RECENT_VIEWS = 10_000;

/** All the Entry Bar ever looks at. Note the absence of a subscriber count. */
export type EntryBarVideo = {
	publishedAt: number;
	viewCount: number;
};

/**
 * The views a Channel has earned recently, approximated by the lifetime views of the
 * Videos it published inside the window.
 *
 * It is an approximation because a ChannelSource reports a Video's views for all time,
 * not its views this month — so an old Video going viral today is invisible here, and
 * a Video published inside the window is credited with every view it has ever had.
 * Correcting either needs two crawls to difference against, and the bar has to hold on
 * day 0, from a single crawl, or nothing can be admitted at all.
 */
function recentViews(videos: readonly EntryBarVideo[], now: number): number {
	const windowOpenedAt = now - RECENT_WINDOW_DAYS * DAY;
	return videos
		.filter((video) => video.publishedAt >= windowOpenedAt)
		.reduce((views, video) => views + video.viewCount, 0);
}

/**
 * Whether a Channel is allowed into the index — and, run against a Channel already in
 * it, whether it may stay.
 */
export function passesEntryBar(
	videos: readonly EntryBarVideo[],
	now: number,
): boolean {
	return recentViews(videos, now) >= MINIMUM_RECENT_VIEWS;
}
