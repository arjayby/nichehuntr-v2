/**
 * Refresh: re-reading a Channel from its ChannelSource, updating our beliefs about it,
 * and appending a Channel Snapshot. Refresh is what we own — it is the origin of all
 * history, and a day it does not run is subscriber-growth data lost permanently. That
 * is why it ships before anything a user can see.
 *
 * The crawl itself is `ingestion.ingestChannel`: re-reading a Channel is the same act
 * as reading it the first time, so there is one crawl path and one place Crawl Budget
 * is spent. This module is only the *policy* deciding which Channels get crawled.
 *
 * That policy is deliberately flat for now — least recently read first, up to a fixed
 * batch. Refresh is not meant to stay uniform: priority by Momentum, user demand and
 * volatility is #9, and it replaces the ordering here without touching the crawl.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalQuery } from "./_generated/server";

const HOUR = 60 * 60 * 1000;

/** How stale a Channel must be before it is worth spending a crawl on again. */
const REFRESH_AFTER_MS = 24 * HOUR;

/**
 * How many Channels one scheduled run crawls: a placeholder Crawl Budget, and the
 * only thing standing between us and the whole index on every tick. Real budget
 * accounting is #9.
 */
const REFRESH_BATCH_SIZE = 50;

/** The Channels we have not looked at in longest, provided they are due at all. */
export const dueForRefresh = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const staleBefore = Date.now() - REFRESH_AFTER_MS;
    const due = await ctx.db
      .query("channels")
      .withIndex("by_last_refreshed_at", (q) =>
        q.lte("lastRefreshedAt", staleBefore),
      )
      .take(args.limit ?? REFRESH_BATCH_SIZE);
    return due.map((channel) => channel.youtubeChannelId);
  },
});

/**
 * Refreshes the Channels that are due. Runs on a schedule (see `crons.ts`), because a
 * Refresh that only ever runs on demand records history only for Channels somebody
 * happened to ask about.
 *
 * Each crawl is scheduled separately so that one Channel deleted on YouTube costs us
 * that Channel's Refresh and not the rest of the batch's.
 */
export const refreshDueChannels = internalAction({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const due = await ctx.runQuery(internal.refresh.dueForRefresh, {
      limit: args.limit,
    });

    for (const youtubeChannelId of due) {
      await ctx.scheduler.runAfter(0, internal.ingestion.ingestChannel, {
        youtubeChannelId,
      });
    }

    return { channelsScheduled: due.length };
  },
});
