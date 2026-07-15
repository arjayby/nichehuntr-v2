import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
	internalAction,
	internalMutation,
	type MutationCtx,
} from "./_generated/server";
import {
	computeVolatility,
	scheduleRefresh,
	type TakenStats,
	VOLATILITY_WINDOW,
} from "./crawl/priority";
import {
	getChannelSource,
	sourceChannelValidator,
	sourceVideoValidator,
} from "./discovery/channelSource";
import { statsOf } from "./discovery/channelStats";
import { passesEntryBar } from "./discovery/entryBar";
import { deriveForm } from "./discovery/form";
import { computeSignals } from "./discovery/signals";
import { computeGrowth, growthAnchors } from "./growth";
import { getSearchIndex, projectChannel } from "./search/searchIndex";

/**
 * How many recent Videos one crawl of a Channel reads. A rebuild of the search projection
 * reproduces the same recent-Videos set from Convex, so it reads this too.
 */
export const RECENT_VIDEO_LIMIT = 50;

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

		const stored = await ctx.runMutation(internal.ingestion.storeChannel, {
			channel,
			videos,
		});

		// Sync the Channel's projection into the search engine after Convex has committed it.
		// This is the one place a crawl touches the engine, and it happens here in the action
		// rather than in the mutation because only an action may reach outside Convex.
		//
		// The projection is derived, eventually-consistent data: Convex is already the system
		// of record, so an engine that is briefly down must not fail a crawl that has already
		// spent its Crawl Budget and written the truth. A failed sync leaves search a little
		// stale until the next Refresh or a rebuild re-projects the Channel — never wrong at
		// the source (see `docs/adr/0001-external-search-engine-for-channel-search.md`).
		if (stored.projection !== null) {
			try {
				await getSearchIndex().upsert([stored.projection]);
			} catch (error) {
				// Resolving the engine is inside the guard too: with no engine configured — the
				// state before one is wired up — this must degrade to a stale projection, not a
				// failed crawl. Anything wrong with the sync leaves Convex untouched and correct.
				console.error(
					`Search projection failed for ${args.youtubeChannelId}; Convex remains the source of record`,
					error,
				);
			}
		}

		return stored;
	},
});

/**
 * The Channel's last few Snapshots, oldest first — the only place Snapshots are read
 * outside the job that computes Growth Metrics, and still never on a search path.
 */
async function recentSnapshots(
	ctx: MutationCtx,
	channelId: Id<"channels"> | undefined,
): Promise<TakenStats[]> {
	if (channelId === undefined) {
		return [];
	}
	const newestFirst = await ctx.db
		.query("channelSnapshots")
		.withIndex("by_channel_taken_at", (q) => q.eq("channelId", channelId))
		.order("desc")
		.take(VOLATILITY_WINDOW);

	return newestFirst
		.map((snapshot) => ({ ...statsOf(snapshot), takenAt: snapshot.takenAt }))
		.reverse();
}

/**
 * Stores everything one crawl of a Channel learned, if the Entry Bar lets the Channel
 * in. It does six things, and a Refresh is exactly this run a second time:
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
 * 5. Subtracts older Snapshots from the current stats to denormalise the Channel's Growth
 *    Metrics onto it, so a search sorts a rising Channel above a merely large one without
 *    computing across Snapshots. A window with no Snapshot old enough to anchor it stays
 *    unavailable, which on a Channel we have only just started crawling is every window
 *    but the shortest.
 * 6. Re-prices the Channel's Refresh priority against what it just learned, and books it
 *    back into the crawl queue at the interval that priority earned. A Channel that just
 *    turned hot is not left waiting on the interval it had while it was cold.
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
			return {
				admitted: false,
				channelId: null,
				videosIngested: 0,
				// A Channel outside the index projects to nothing: there is no searchable
				// Channel to sync, and no row for a later rebuild to find either.
				projection: null,
			} as const;
		}

		const signals = computeSignals({ channel, videos: crawled, now });
		// What this crawl found, measured against what the last few found: how fast the
		// Channel moves is the third thing (with Momentum and demand) that decides how
		// closely it is worth watching. The stats we just read are the newest point in that
		// history, and they count — a Channel that jumped today is volatile today, not at
		// its next Refresh.
		const volatility = computeVolatility([
			...(await recentSnapshots(ctx, existing?._id)),
			{ ...statsOf(channel), takenAt: now },
		]);

		// Every window's growth against the Snapshot anchoring it. A Channel we are seeing
		// for the first time has no history to subtract, so every window comes back
		// unavailable — the honest reading until its Snapshots have had time to accrue.
		const growth = computeGrowth({
			current: statsOf(channel),
			anchors:
				existing === null ? {} : await growthAnchors(ctx, existing._id, now),
		});

		const channelFields = {
			...channel,
			...signals,
			...growth,
			volatility,
			...scheduleRefresh(
				{
					momentum: signals.momentum,
					demand: existing?.demand,
					volatility,
				},
				now,
			),
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

		// The Channel's search projection, derived from the same crawl that wrote it: the
		// text a keyword matches — its title, description and its Videos' titles — beside the
		// numbers a search filters and sorts on. A Channel that has fallen below the Entry Bar
		// is projected too, carrying `meetsEntryBar: false`, so it drops out of search results
		// without being deleted and a rebuild agrees with this incremental sync on what the
		// engine holds. The action returns this to the engine; the mutation only builds it.
		const projection = projectChannel(
			channelFields,
			crawled.map((video) => video.title),
		);

		return {
			admitted: meetsEntryBar,
			channelId,
			videosIngested: crawled.length,
			projection,
		} as const;
	},
});
