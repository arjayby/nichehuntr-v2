/**
 * Refresh: re-reading a Channel from its ChannelSource, updating our beliefs about it,
 * and appending a Channel Snapshot. Refresh is what we own — it is the origin of all
 * history (see `channelSnapshots` in `schema.ts`), which is why it ships before there
 * is any UI to read it.
 *
 * The crawl itself is `ingestion.ingestChannel`: re-reading a Channel is the same act
 * as reading it the first time, so there is one crawl path and one place Crawl Budget
 * is spent. This module is only the *policy* deciding which Channels get crawled.
 *
 * That policy is deliberately flat for now — least recently attempted first, up to a
 * fixed budget. Refresh is not meant to stay uniform: priority by Momentum, user demand
 * and volatility is #9, and it replaces the ordering here without touching the crawl.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";

const HOUR = 60 * 60 * 1000;

/** How stale a Channel must be before it is worth spending a crawl on it again. */
const REFRESH_AFTER_MS = 24 * HOUR;

/**
 * The Crawl Budget one scheduled run may spend: the only thing standing between us and
 * crawling the whole index every tick. Real budget accounting — spent, remaining, and
 * allocated by policy across Refresh and Discovery — is #9.
 */
const CRAWL_BUDGET_PER_RUN = 50;

/**
 * Takes the Channels that are due out of the queue, and marks them as attempted before
 * anyone crawls them.
 *
 * Claiming is what makes the budget real. A Channel's place is spent when we *try* to
 * read it, not when we succeed:
 *
 * - Two runs overlapping (a batch still draining when the next tick fires) would
 *   otherwise both find the same Channels due, and pay for them twice.
 * - A Channel deleted on YouTube fails every crawl forever. Queued on Freshness it
 *   would never advance, sit at the head of the queue, and starve every live Channel
 *   behind it — the index would quietly stop Refreshing.
 *
 * Freshness itself is untouched here: only a crawl that actually read the Channel may
 * claim to have refreshed it.
 */
export const claimDueChannels = internalMutation({
	args: { limit: v.optional(v.number()) },
	handler: async (ctx, args) => {
		const now = Date.now();
		const due = await ctx.db
			.query("channels")
			.withIndex("by_last_refresh_attempted_at", (q) =>
				q.lte("lastRefreshAttemptedAt", now - REFRESH_AFTER_MS),
			)
			.take(args.limit ?? CRAWL_BUDGET_PER_RUN);

		for (const channel of due) {
			await ctx.db.patch(channel._id, { lastRefreshAttemptedAt: now });
		}
		return due.map((channel) => channel.youtubeChannelId);
	},
});

/**
 * Refreshes the Channels that are due. Runs on a schedule (see `crons.ts`), because a
 * Refresh that only ever ran on demand would record history only for the Channels
 * somebody happened to ask about.
 *
 * Each crawl is scheduled separately, so one Channel deleted on YouTube costs us that
 * Channel's Refresh and not the rest of the batch's.
 */
export const refreshDueChannels = internalAction({
	args: { limit: v.optional(v.number()) },
	handler: async (ctx, args) => {
		const claimed = await ctx.runMutation(internal.refresh.claimDueChannels, {
			limit: args.limit,
		});

		for (const youtubeChannelId of claimed) {
			await ctx.scheduler.runAfter(0, internal.ingestion.ingestChannel, {
				youtubeChannelId,
			});
		}

		return { channelsScheduled: claimed.length };
	},
});
