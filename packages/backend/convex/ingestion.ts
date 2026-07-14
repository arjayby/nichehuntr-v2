import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation } from "./_generated/server";
import {
	getChannelSource,
	sourceChannelValidator,
	sourceVideoValidator,
} from "./discovery/channelSource";
import { statsOf } from "./discovery/channelStats";
import { passesEntryBar } from "./discovery/entryBar";
import { deriveForm } from "./discovery/form";
import { computeSignals } from "./discovery/signals";

/** How many recent Videos one crawl of a Channel reads. */
const RECENT_VIDEO_LIMIT = 50;

/**
 * Reads a Channel and its recent Videos from the ChannelSource and stores them, if
 * the Entry Bar lets it in.
 *
 * Internal: this spends Crawl Budget, so it is reachable only from our own jobs,
 * never from a client.
 */
export const ingestChannel = internalAction({
	args: {
		youtubeChannelId: v.string(),
		videoLimit: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const source = getChannelSource();

		const channel = await source.getChannel(args.youtubeChannelId);
		if (channel === null) {
			throw new Error(`ChannelSource has no Channel ${args.youtubeChannelId}`);
		}
		const videos = await source.listVideos(args.youtubeChannelId, {
			limit: args.videoLimit ?? RECENT_VIDEO_LIMIT,
		});

		return await ctx.runMutation(internal.ingestion.storeChannel, {
			channel,
			videos,
		});
	},
});

/**
 * Stores everything one crawl of a Channel learned, if the Entry Bar lets the Channel
 * in. It does four things, and a Refresh is exactly this run a second time:
 *
 * 1. Judges the Channel against the Entry Bar. Admission and age-out are the same
 *    judgement made at the same moment, so the index cannot drift out of step with the
 *    bar: a Channel we have never seen that is below the bar is never let in at all,
 *    and a Channel already in the index that has fallen below it is flagged, not
 *    deleted. A flagged Channel stops being searchable, but its row, its Videos and its
 *    Snapshots survive the dip, so a Channel that recovers keeps the history we cannot
 *    backfill. Refresh keeps crawling it, which is what lets it earn its way back in.
 * 2. Upserts the Channel and its Videos, keyed on YouTube's IDs, so that re-crawling a
 *    Channel updates our beliefs about it rather than duplicating it, and records the
 *    Channel's Freshness.
 * 3. Computes the Channel's Signals from this one crawl and stores them on the Channel
 *    — so a search reads a number off the Channel and never computes across its Videos.
 * 4. Appends a Channel Snapshot, which is how history accrues at all.
 */
export const storeChannel = internalMutation({
	args: {
		channel: sourceChannelValidator,
		videos: v.array(sourceVideoValidator),
	},
	handler: async (ctx, { channel, videos }) => {
		const now = Date.now();
		const crawled = videos.map((video) => ({
			...video,
			form: deriveForm(video.durationSeconds),
		}));

		const existing = await ctx.db
			.query("channels")
			.withIndex("by_youtube_channel_id", (q) =>
				q.eq("youtubeChannelId", channel.youtubeChannelId),
			)
			.unique();

		// A Channel we have never seen that is below the bar is turned away whole: no row,
		// no Videos, and no Snapshot, because a Channel outside the index has no history to
		// keep.
		const meetsEntryBar = passesEntryBar(videos, now);
		if (existing === null && !meetsEntryBar) {
			return { admitted: false, channelId: null, videosIngested: 0 } as const;
		}

		const channelFields = {
			...channel,
			...computeSignals({ channel, videos: crawled, now }),
			lastRefreshedAt: now,
			lastRefreshAttemptedAt: now,
			meetsEntryBar,
		};
		let channelId: Id<"channels">;
		if (existing === null) {
			channelId = await ctx.db.insert("channels", channelFields);
		} else {
			channelId = existing._id;
			// A Signal this crawl could not compute is patched away rather than left
			// behind: an absent Momentum is honest, a stale one is a lie.
			await ctx.db.patch(channelId, channelFields);
		}

		// Every crawl is a measurement, so every crawl appends a Channel Snapshot —
		// including the first one, which no later Refresh can go back and take.
		await ctx.db.insert("channelSnapshots", {
			channelId,
			...statsOf(channel),
			takenAt: now,
		});

		for (const video of crawled) {
			const existingVideo = await ctx.db
				.query("videos")
				.withIndex("by_youtube_video_id", (q) =>
					q.eq("youtubeVideoId", video.youtubeVideoId),
				)
				.unique();

			const videoFields = { ...video, channelId };
			if (existingVideo === null) {
				await ctx.db.insert("videos", videoFields);
			} else {
				await ctx.db.patch(existingVideo._id, videoFields);
			}
		}

		return {
			admitted: meetsEntryBar,
			channelId,
			videosIngested: crawled.length,
		} as const;
	},
});
