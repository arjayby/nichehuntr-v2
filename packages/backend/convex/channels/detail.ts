/**
 * The Channel detail read: one Channel, in full, for the screen that makes the case for (or
 * against) cloning it. Its Signals brought together, its recent Videos with the numbers the
 * case rests on, and which of those Videos broke out against the Channel's *own* median.
 *
 * A reactive Convex query, unlike search. Search combines a keyword with several numeric ranges
 * and an arbitrary sort, which only an external engine expresses, so it is an action over HTTP
 * (ADR-0001). A single Channel and its Videos are flat documents Convex already holds — the
 * system of record — so reading one is a plain query that live-updates as the next Refresh
 * rewrites it. Nothing here spends a Credit or a Crawl Budget: this reads the index, it does
 * not go out to YouTube.
 */
import { v } from "convex/values";
import { query } from "../_generated/server";
import type { Form } from "../discovery/form";
import { markOutliers, type Outlierness } from "../discovery/outliers";
import type { Signals } from "../discovery/signals";
import { RECENT_VIDEO_LIMIT } from "../ingestion";

/** One recent Video, with the mark saying how it did against the Channel's median. */
export type ChannelDetailVideo = {
	youtubeVideoId: string;
	title: string;
	publishedAt: number;
	viewCount: number;
	form: Form;
} & Outlierness;

/**
 * A Channel in full: everything the detail screen shows, and nothing it does not.
 *
 * The Channel's own document is a superset of this — it also carries its Refresh schedule, its
 * volatility, its Entry Bar bookkeeping — none of which the case for cloning a Channel is made
 * of. So the query names the fields the screen reads rather than handing the raw row out whole,
 * the same discipline the search projection keeps: the shape is a product surface, and a field
 * that reaches the client is a field a screen is meant to show. Every Signal rides along (the
 * spread of `Signals`), because the whole point of the screen is to see them together.
 */
export type ChannelDetail = {
	youtubeChannelId: string;
	title: string;
	description: string;
	handle?: string;
	subscriberCount: number;
	totalViewCount: number;
	/** When we last read this Channel — its Freshness, and the age of every number here. */
	lastRefreshedAt: number;
	/** Whether it still clears the Entry Bar. A flagged Channel still has a detail to show. */
	meetsEntryBar: boolean;
	videos: ChannelDetailVideo[];
} & Signals;

export const getChannelDetail = query({
	args: { youtubeChannelId: v.string() },
	handler: async (ctx, { youtubeChannelId }): Promise<ChannelDetail | null> => {
		const channel = await ctx.db
			.query("channels")
			.withIndex("by_youtube_channel_id", (q) =>
				q.eq("youtubeChannelId", youtubeChannelId),
			)
			.unique();

		// A Channel the index has never seen has no case to make. Null rather than an empty
		// shell, so the screen can tell "we hold nothing on this Channel" from "we hold a
		// Channel with no Videos yet" — two different things to say to a user.
		if (channel === null) {
			return null;
		}

		// The most recent Videos, newest first — the case for a Channel leads with what it just
		// did. Bounded by `RECENT_VIDEO_LIMIT` off an index ordered by publish date, not collected
		// whole: a Channel keeps a Video row per upload across every Refresh and never deletes
		// one, so the stored set grows without limit and only the recent slice belongs here anyway.
		const newestFirst = await ctx.db
			.query("videos")
			.withIndex("by_channel_published_at", (q) =>
				q.eq("channelId", channel._id),
			)
			.order("desc")
			.take(RECENT_VIDEO_LIMIT);

		// Marked against the Channel's *own* Median Views per Video — the same Signal the screen
		// prints — so a Video flagged an outlier and the median shown beside it always agree, and
		// the comparison is never against a global median the product exists to avoid.
		const marked = markOutliers(newestFirst, channel.medianViewsPerVideo);

		return {
			youtubeChannelId: channel.youtubeChannelId,
			title: channel.title,
			description: channel.description,
			handle: channel.handle,
			subscriberCount: channel.subscriberCount,
			totalViewCount: channel.totalViewCount,
			lastRefreshedAt: channel.lastRefreshedAt,
			meetsEntryBar: channel.meetsEntryBar,
			momentum: channel.momentum,
			viewsPerSubscriber: channel.viewsPerSubscriber,
			medianViewsPerVideo: channel.medianViewsPerVideo,
			outlierRatio: channel.outlierRatio,
			uploadCadencePerWeek: channel.uploadCadencePerWeek,
			channelAgeDays: channel.channelAgeDays,
			shortsUploadShare: channel.shortsUploadShare,
			shortsViewShare: channel.shortsViewShare,
			videos: marked.map((video) => ({
				youtubeVideoId: video.youtubeVideoId,
				title: video.title,
				publishedAt: video.publishedAt,
				viewCount: video.viewCount,
				form: video.form,
				viewsVsMedian: video.viewsVsMedian,
				isOutlier: video.isOutlier,
			})),
		};
	},
});
