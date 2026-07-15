/**
 * Refresh: re-reading a Channel from its ChannelSource, updating our beliefs about it,
 * and appending a Channel Snapshot. Refresh is what we own — it is the origin of all
 * history (see `channelSnapshots` in `schema.ts`), which is why it ships before there
 * is any UI to read it.
 *
 * The crawl itself is `ingestion.ingestChannel`: re-reading a Channel is the same act
 * as reading it the first time, so there is one crawl path and one place Crawl Budget
 * is spent. This module is only the *policy* deciding which Channels get crawled, and
 * how much of the day's budget that may cost.
 *
 * Refresh is not uniform. A Channel's priority — its Momentum, the demand for it, its
 * volatility — buys it a shorter interval between crawls (see `crawl/priority.ts`), and
 * the queue is worked in the order those intervals fall due. Ordering by *deadline* and
 * not by priority itself is what keeps this a queue rather than an auction: a hot
 * Channel comes due four times as often as a flat one, but a flat one still reaches the
 * head of the queue by waiting, and gets crawled — which is the only way we would ever
 * learn it had stopped being flat, or gone quiet enough to age out of the index.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import {
	DAILY_CRAWL_BUDGET,
	recordCrawlSpend,
	remainingCrawlBudget,
} from "./crawl/budget";
import { scheduleRefresh } from "./crawl/priority";

/**
 * How many times a day the Refresh scheduler runs (see `crons.ts`, which takes its
 * interval from this). It sets how fast the index drains its backlog of due Channels,
 * not how fresh any one Channel is — that is its priority's business.
 */
export const REFRESH_RUNS_PER_DAY = 24;

/**
 * The most one scheduled run may claim, whatever the day's budget still allows: the only
 * thing standing between an idle index and crawling its whole backlog in one tick.
 *
 * The day's share, and not a number of its own. A per-run cap chosen independently would
 * silently become the real constraint the moment it fell below the budget divided by the
 * day's runs — the ledger would show budget going unspent every day while Channels sat
 * overdue, and the Crawl Budget we reason about would not be the one we were actually
 * rationed by.
 */
export const CRAWL_BUDGET_PER_RUN = Math.ceil(
	DAILY_CRAWL_BUDGET / REFRESH_RUNS_PER_DAY,
);

/**
 * Takes the Channels that have come due out of the queue, soonest-due first, and marks
 * them as attempted before anyone crawls them — as many as the day's Crawl Budget can
 * still pay for, and no more.
 *
 * Claiming is what makes the budget real. A Channel's place is spent when we *try* to
 * read it, not when we succeed:
 *
 * - Two runs overlapping (a batch still draining when the next tick fires) would
 *   otherwise both find the same Channels due, and pay for them twice.
 * - A Channel deleted on YouTube fails every crawl forever. Left at the deadline it had,
 *   it would sit at the head of the queue and starve every live Channel behind it — the
 *   index would quietly stop Refreshing.
 *
 * So a claim books the Channel back into the queue at the interval its priority earned,
 * on the beliefs we hold about it *now*. A crawl that actually reads it overwrites that
 * with a deadline priced on what it found. Freshness itself is untouched here: only a
 * crawl that read the Channel may claim to have refreshed it.
 *
 * When the budget cannot cover everything due, the Channels left behind keep their
 * deadlines — they stay due, and are first in line next run. A deferred Refresh is
 * Freshness we owe someone, so the shortfall is booked to the day's ledger rather than
 * dropped in silence.
 */
export const claimDueChannels = internalMutation({
	args: { limit: v.optional(v.number()) },
	handler: async (ctx, args) => {
		const now = Date.now();
		const remaining = await remainingCrawlBudget(ctx, { now });
		const perRun = args.limit ?? CRAWL_BUDGET_PER_RUN;
		const affordable = Math.min(perRun, remaining);

		// One more than we can take, so we find out whether we left work behind.
		const due = await ctx.db
			.query("channels")
			.withIndex("by_refresh_due_at", (q) => q.lte("refreshDueAt", now))
			.take(affordable + 1);

		const claimed = due.slice(0, affordable);
		// Work left behind because the *day* ran out, which is the shortfall worth counting.
		// A run that merely hit its per-run cap has left the rest to the next tick an hour
		// later; a run that hit the day's budget has left it to tomorrow.
		const exhausted = due.length > affordable && remaining <= perRun;

		for (const channel of claimed) {
			await ctx.db.patch(channel._id, {
				lastRefreshAttemptedAt: now,
				...scheduleRefresh(channel, now),
			});
		}

		if (claimed.length > 0 || exhausted) {
			await recordCrawlSpend(ctx, {
				now,
				crawls: claimed.length,
				exhausted,
			});
		}

		return claimed.map((channel) => channel.youtubeChannelId);
	},
});

/**
 * Refreshes the Channels that have come due. Runs on a schedule (see `crons.ts`),
 * because a Refresh that only ever ran on demand would record history only for the
 * Channels somebody happened to ask about.
 *
 * Each crawl is scheduled separately, so one Channel deleted on YouTube costs us that
 * Channel's Refresh and not the rest of the batch's.
 */
export const refreshDueChannels = internalAction({
	args: { limit: v.optional(v.number()) },
	handler: async (ctx, args): Promise<{ channelsScheduled: number }> => {
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
