/**
 * Signals: the normalised measures a Channel is sorted by. Each one compares a
 * Channel to itself or to its own size, so a 300-subscriber Channel that did 800k
 * views this month can outrank a 50,000-subscriber Channel that has gone quiet.
 *
 * Raw subscriber and total-view counts are *not* Signals. They stay plain stats and
 * are filters later, because raw size ranks Channels by how hard they are to compete
 * with — the opposite of the question a creator is asking.
 *
 * There is no composite score, deliberately. Every Signal below is explainable in one
 * sentence and checkable by eye.
 *
 * A Signal is `undefined` when it is genuinely unknowable — never zero. Zero says "we
 * looked and there was nothing"; undefined says "there was nothing to look at". A
 * search that sorted undefined as zero would rank a Channel we know nothing about as
 * the worst Channel we know.
 *
 * The definitions here are CONTEXT.md's, verbatim. Where one looks arbitrary, it is
 * the glossary's arbitrariness, not this module's.
 */
import { type Infer, v } from "convex/values";
import type { Form } from "./form";
import { DAY, RECENT_WINDOW_DAYS } from "./recentWindow";

const DAYS_PER_WEEK = 7;

export const signalsValidator = v.object({
	/**
	 * Views on the Channel's recent Videos, against its own lifetime average Video.
	 * Above 1 means it is heating up.
	 *
	 * Computable from a single crawl — every Video carries a publish date and a view
	 * count — so it works on day 0 and never waits on Channel Snapshots. That is why it,
	 * and not subscriber growth, is the Signal the product leads with.
	 */
	momentum: v.optional(v.number()),
	/** How many views the Channel has earned per subscriber it has. */
	viewsPerSubscriber: v.optional(v.number()),
	/** What a typical Video on the Channel does, immune to a single viral fluke. */
	medianViewsPerVideo: v.optional(v.number()),
	/** The Channel's best recent Video against its own typical Video. */
	outlierRatio: v.optional(v.number()),
	/** Videos published per week in the recent window — the labour the niche demands. */
	uploadCadencePerWeek: v.number(),
	/** Days since the Channel was created on YouTube. */
	channelAgeDays: v.number(),
	/** The share of the Channel's recent uploads that are Shorts — what it *makes*. */
	shortsUploadShare: v.optional(v.number()),
	/** The share of its recent views that came from Shorts — what *works*. */
	shortsViewShare: v.optional(v.number()),
});

export type Signals = Infer<typeof signalsValidator>;

/** The only fields of a Channel a Signal is computed from. */
export type SignalChannel = {
	subscriberCount: number;
	totalViewCount: number;
	/** Every Video the Channel has ever published, not just the ones we crawled. */
	videoCount: number;
	/** When the Channel was created on YouTube. */
	publishedAt: number;
};

/** The only fields of a Video a Signal is computed from. */
export type SignalVideo = {
	publishedAt: number;
	viewCount: number;
	form: Form;
};

/**
 * Divides, or gives up. Guards every ratio whose denominator can be zero: a Channel
 * with no subscribers, no Videos, or no views has no ratio — not a ratio of zero.
 *
 * Exported because the "no ratio from a zero denominator" rule is not the Signals' alone:
 * marking a Video against a Channel's median (`discovery/outliers.ts`) is the same division
 * and the same give-up, and the two must not disagree on what an absent ratio means.
 */
export function divideOrUndefined(
	numerator: number,
	denominator: number,
): number | undefined {
	return denominator === 0 ? undefined : numerator / denominator;
}

function median(values: number[]): number | undefined {
	if (values.length === 0) {
		return undefined;
	}
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1
		? (sorted[middle] as number)
		: ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

const sum = (values: number[]) => values.reduce((total, n) => total + n, 0);

const viewsOf = (videos: SignalVideo[]) =>
	videos.map((video) => video.viewCount);

/**
 * Computes every Signal for a Channel from one crawl of it. Pure: the caller passes
 * the clock in, so the arithmetic can be tested at its edges directly.
 *
 * `videos` is what the crawl returned — the Channel's most recent Videos, not its
 * whole back-catalogue. Momentum's baseline is therefore taken from the Channel's
 * lifetime *stats* (`totalViewCount / videoCount`), which cover every Video it ever
 * published, rather than from the handful the crawl happened to see.
 */
export function computeSignals({
	channel,
	videos,
	now,
}: {
	channel: SignalChannel;
	videos: SignalVideo[];
	now: number;
}): Signals {
	const windowStart = now - RECENT_WINDOW_DAYS * DAY;
	const recent = videos.filter((video) => video.publishedAt >= windowStart);
	const recentViews = viewsOf(recent);
	const recentShorts = recent.filter((video) => video.form === "short");

	const typicalVideo = median(viewsOf(videos));
	const lifetimeAverageVideo = divideOrUndefined(
		channel.totalViewCount,
		channel.videoCount,
	);
	const recentAverageVideo = divideOrUndefined(sum(recentViews), recent.length);

	return {
		// Undefined when the Channel published nothing recently, or when it has no
		// lifetime average to measure the recent Videos against.
		momentum:
			recentAverageVideo === undefined || lifetimeAverageVideo === undefined
				? undefined
				: divideOrUndefined(recentAverageVideo, lifetimeAverageVideo),
		viewsPerSubscriber: divideOrUndefined(
			channel.totalViewCount,
			channel.subscriberCount,
		),
		medianViewsPerVideo: typicalVideo,
		// The *recent* best, not the best we ever crawled: a six-month-old viral hit is
		// not "a specific idea that just printed", and must not claim to be one.
		outlierRatio:
			recent.length === 0 || typicalVideo === undefined
				? undefined
				: divideOrUndefined(Math.max(...recentViews), typicalVideo),
		uploadCadencePerWeek: recent.length / (RECENT_WINDOW_DAYS / DAYS_PER_WEEK),
		/**
		 * Ages between Refreshes, like every other stat on the Channel: it is true as of
		 * `lastRefreshedAt`, not as of now.
		 */
		channelAgeDays: Math.floor((now - channel.publishedAt) / DAY),
		shortsUploadShare: divideOrUndefined(recentShorts.length, recent.length),
		shortsViewShare: divideOrUndefined(
			sum(viewsOf(recentShorts)),
			sum(recentViews),
		),
	};
}
