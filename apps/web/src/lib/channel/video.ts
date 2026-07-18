/**
 * A recent Video as the Channel detail shows it: the view count, the Form and the publish date
 * the case for cloning a Channel is read off, plus the outlier mark that says which Video was
 * the specific idea that worked.
 *
 * The outlier verdict itself is the backend's — a Video is measured against the Channel's own
 * Median Views per Video where the median lives, not recomputed here (see
 * `convex/discovery/outliers.ts`). This module only puts that verdict into words.
 */
import type { ChannelDetailVideo } from "@nichehuntr-v2/backend/convex/channels/detail";

import { describeFreshness } from "@/lib/search/freshness";
import { formatCount } from "@/lib/search/stats";

/** A Video's numbers, written the way the detail screen prints them. */
export type ShownVideo = {
	/** Views, as a creator reads them: 800,000 is "800K". */
	views: string;
	/** "Short" or "Long-form" — the Form said in words, never the stored token. */
	formLabel: string;
	/** When it went up, e.g. "2 days ago". */
	published: string;
	isOutlier: boolean;
	/**
	 * How far it beat the Channel's median, e.g. "5.0× median" — present only when it broke out.
	 * The mark *is* the case, so it carries the multiple rather than a bare "outlier" badge: the
	 * user is here to see which idea printed and by how much.
	 */
	outlierLabel?: string;
};

const FORM_LABELS = { short: "Short", longform: "Long-form" } as const;

export function describeVideo(
	video: ChannelDetailVideo,
	now: number = Date.now(),
): ShownVideo {
	return {
		views: formatCount(video.viewCount),
		formLabel: FORM_LABELS[video.form],
		// The same "X ago" phrasing a Freshness uses — an age in the largest unit that still
		// carries information — reused rather than re-derived so the whole app says time one way.
		published: describeFreshness(video.publishedAt, now).label,
		isOutlier: video.isOutlier,
		outlierLabel:
			video.isOutlier && video.viewsVsMedian !== undefined
				? `${video.viewsVsMedian.toFixed(1)}× median`
				: undefined,
	};
}
