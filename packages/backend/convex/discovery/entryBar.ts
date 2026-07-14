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

// The bar itself. Tune the index's appetite with these two numbers and nowhere else:
// every admission and every age-out in the codebase reads them.

/** Views a Channel must have earned inside the window to be worth indexing. */
export const MINIMUM_RECENT_VIEWS = 10_000;

/** How far back "recent" reaches. */
export const RECENT_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

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
  const windowOpenedAt = now - RECENT_WINDOW_DAYS * DAY_MS;
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
