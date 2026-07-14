/**
 * Crawl Budget: the finite quota of external API calls we may spend in a day, and the
 * ledger recording what became of it.
 *
 * The ledger is the point. Index size, Freshness and Coverage are all direct functions
 * of this budget, so a budget spent without a record of where it went is a product whose
 * quality we cannot see. When the budget runs out, Refreshes are *deferred*, never
 * dropped — the Channels that went unread stay due and are first in line next run — and
 * every run that hits the wall is counted here, so we can watch the index degrade before
 * a user does.
 */
import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { internalQuery } from "../_generated/server";

/**
 * The day's quota, in crawls. One crawl is one Channel read from a ChannelSource.
 *
 * Allocated by policy across Refresh and Discovery: today Refresh is the only spender,
 * and when Discovery lands it draws from this same ledger, because a call spent looking
 * for new Channels is a call not spent keeping the ones we have honest.
 */
export const DAILY_CRAWL_BUDGET = 5_000;

/**
 * The day a crawl is billed to, in UTC. UTC and not the user's day, because the quota
 * we are rationing is the vendor's and it resets on the vendor's clock, not on ours.
 */
export function crawlDay(now: number): string {
	return new Date(now).toISOString().slice(0, 10);
}

const ledgerFor = (ctx: QueryCtx, day: string) =>
	ctx.db
		.query("crawlBudget")
		.withIndex("by_day", (q) => q.eq("day", day))
		.unique();

/**
 * What the day's Crawl Budget has bought and what is left of it — the ledger as anyone
 * asking should read it, whether that is the scheduler about to spend or an operator
 * asking why the index is stale.
 */
async function consumptionOn(
	ctx: QueryCtx,
	now: number,
): Promise<{
	day: string;
	budget: number;
	spent: number;
	remaining: number;
	exhaustedRuns: number;
}> {
	const day = crawlDay(now);
	const ledger = await ledgerFor(ctx, day);
	const budget = ledger?.budget ?? DAILY_CRAWL_BUDGET;
	const spent = ledger?.spent ?? 0;

	return {
		day,
		budget,
		spent,
		/** Zero once the day is spent — never negative. */
		remaining: Math.max(0, budget - spent),
		/** Runs that came up short: each one deferred a Refresh that had come due. */
		exhaustedRuns: ledger?.exhaustedRuns ?? 0,
	};
}

/** What is left to spend today. */
export async function remainingCrawlBudget(
	ctx: QueryCtx,
	{ now }: { now: number },
): Promise<number> {
	return (await consumptionOn(ctx, now)).remaining;
}

/**
 * Bills crawls to today's ledger, opening it if this is the day's first spend.
 *
 * `exhausted` says the run ran out of budget with Channels still due. It is counted, not
 * logged and forgotten: a deferred Refresh is Freshness we owe a user, and the number of
 * runs that deferred one is how we find out we are underfunded.
 */
export async function recordCrawlSpend(
	ctx: MutationCtx,
	{
		now,
		crawls,
		exhausted = false,
	}: { now: number; crawls: number; exhausted?: boolean },
): Promise<void> {
	const day = crawlDay(now);
	const ledger = await ledgerFor(ctx, day);

	if (ledger === null) {
		await ctx.db.insert("crawlBudget", {
			day,
			// The budget is copied onto the day, not read back from the constant: raising
			// the quota tomorrow must not rewrite what yesterday was starved of.
			budget: DAILY_CRAWL_BUDGET,
			spent: crawls,
			exhaustedRuns: exhausted ? 1 : 0,
		});
		return;
	}

	await ctx.db.patch(ledger._id, {
		spent: ledger.spent + crawls,
		exhaustedRuns: ledger.exhaustedRuns + (exhausted ? 1 : 0),
	});
}

/**
 * What a day's Crawl Budget bought and what was left of it. Defaults to today; pass a
 * time on any other day to read that day's ledger, because the question worth asking is
 * usually "when did we start running out", not "are we out right now".
 *
 * Internal: this is an operator's view of our own scarcity, not a user-facing fact.
 */
export const consumption = internalQuery({
	args: { now: v.optional(v.number()) },
	handler: (ctx, args) => consumptionOn(ctx, args.now ?? Date.now()),
});
