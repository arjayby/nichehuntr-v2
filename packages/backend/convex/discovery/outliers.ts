/**
 * Marking the Videos that are outliers on a Channel — the specific ideas that worked.
 *
 * CONTEXT.md's Outlier Ratio is a Channel-level Signal: the *best* recent Video ÷ the
 * Channel's median. This is its per-Video companion, the thing a Channel detail view needs
 * that a single Signal cannot give — *which* Videos broke out, not just how far the best one
 * did. It runs the same comparison the Signal does, one Video at a time.
 *
 * The comparison is always against the **Channel's own median**, never a global one. A Video
 * doing 60k views is a breakout on a Channel whose typical Video does 10k and unremarkable on
 * one whose typical Video does 30k, and the whole product thesis is that the second Channel is
 * not the interesting one. A global threshold would rank Videos by raw size — exactly the
 * mistake the Signals are normalised to avoid.
 */
import { divideOrUndefined } from "./signals";

/**
 * How far above its Channel's median a Video must do to be called an outlier: at least three
 * times the typical Video.
 *
 * A judgement, not a law — the domain's flagship example is a "10× outlier", and there is no
 * canonical cutoff below which a breakout stops counting. Three is chosen to catch a genuine
 * idea that printed while staying clear of ordinary variance: a Video that merely beat the
 * median is a good day, one that trebled it is a format worth cloning. It lives here as a named
 * constant precisely because it is tunable — a single number to move if the mark proves too
 * eager or too shy.
 */
export const OUTLIER_THRESHOLD = 3;

/** The only field of a Video marking reads: its views, measured against the Channel's median. */
type ViewedVideo = { viewCount: number };

/** A Video with the verdict marking adds: how it did against the median, and whether that flags it. */
export type Outlierness = {
	/**
	 * The Video's views ÷ the Channel's median Video. Named for what it is rather than borrowing
	 * "Outlier Ratio" — CONTEXT.md gives that name to the Channel-level Signal (the *best* Video
	 * ÷ median), and this per-Video quantity travels in the same payload as that Signal, so a
	 * shared name would be two different numbers wearing one word. Absent — never zero — when
	 * there is no median to divide by, because a Channel with no typical Video gives nothing to
	 * compare against, and a ratio of zero would be a claim we cannot make.
	 */
	viewsVsMedian: number | undefined;
	/** Whether the ratio clears `OUTLIER_THRESHOLD`. An absent ratio is never an outlier. */
	isOutlier: boolean;
};

/**
 * Annotates each Video with how it did against the Channel's median and whether that makes it
 * an outlier. Pure, order-preserving, and additive: every field on the Video handed in is kept,
 * so a caller can mark the Videos it already holds without rebuilding them.
 *
 * `median` is the Channel's stored Median Views per Video — the same number shown as the Signal
 * — so a Video the view marks as an outlier and the median printed beside it always agree.
 * `undefined` (no crawled Videos) and `0` (crawled Videos, all with zero views) both mean there
 * is nothing to divide by, and both mark nothing — the same give-up `divideOrUndefined` makes
 * for every Signal.
 */
export function markOutliers<V extends ViewedVideo>(
	videos: V[],
	median: number | undefined,
): (V & Outlierness)[] {
	return videos.map((video) => {
		const viewsVsMedian =
			median === undefined
				? undefined
				: divideOrUndefined(video.viewCount, median);
		return {
			...video,
			viewsVsMedian,
			isOutlier:
				viewsVsMedian !== undefined && viewsVsMedian >= OUTLIER_THRESHOLD,
		};
	});
}
