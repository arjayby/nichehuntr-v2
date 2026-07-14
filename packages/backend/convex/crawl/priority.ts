/**
 * Refresh priority: how closely a Channel is watched. Refresh is not uniform, because
 * Crawl Budget is finite — every crawl spent re-reading a Channel that has not moved is
 * a crawl not spent on one that has.
 *
 * Three things earn a Channel a closer watch, and they are CONTEXT.md's, verbatim:
 *
 * - **Momentum** — a fast mover's stats are wrong the fastest.
 * - **demand** — a Channel sitting in users' saved Niches is one someone is about to
 *   look at, so its Freshness is the Freshness they will judge us on.
 * - **volatility** — a Channel that never surprises us can be read rarely without
 *   costing anyone anything, because we could have guessed what it would say.
 *
 * This is a composite score, which CONTEXT.md forbids — for *Signals*. A Signal is a
 * claim we make to a user about a Channel, and a composite one is arbitrary weights
 * wearing a lab coat. Priority is not shown to anyone and asserts nothing about the
 * Channel: it is an internal spending policy, and its weights are falsifiable in the
 * only way that matters — by whether the index is fresh where users are looking.
 */
import type { ChannelStats } from "../discovery/channelStats";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** The interval a Channel we are watching most closely is re-read at. */
export const HOT_REFRESH_INTERVAL_MS = 6 * HOUR;
/** The interval an ordinary Channel is re-read at. */
export const WARM_REFRESH_INTERVAL_MS = 24 * HOUR;
/**
 * The longest we will leave any Channel unread. Even a dull Channel is crawled
 * eventually: its Snapshot history is the only thing that can tell us it stopped being
 * dull, and a Channel that has gone quiet only ages out of the index when a crawl
 * notices.
 */
export const COLD_REFRESH_INTERVAL_MS = 7 * DAY;

/** The Momentum at which a Channel is as hot as this policy bothers to distinguish. */
const RUNAWAY_MOMENTUM = 8;
/** The number of saved Niches beyond which more demand buys no more attention. */
const SATURATING_DEMAND = 5;
/**
 * The daily drift that counts as a Channel fully surprising us: 2% of its subscribers or
 * its views, moved in a day.
 *
 * Small, because the stats it is measured against are lifetime totals, and a lifetime
 * total is a slow number by construction — a mature Channel adding a healthy 1% a day has
 * *doubled* inside a quarter. A threshold set for the swings of a recent-window metric
 * would score the entire index at zero volatility and quietly turn this input off.
 */
const SURPRISING_DAILY_CHANGE = 0.02;

/**
 * The priority at which a Channel earns the closest watch, and the one at which it earns
 * an ordinary one.
 *
 * These are set against what a Channel can actually *score*, not against a tidy 0.6/0.3.
 * A Channel nobody has saved, holding steady, still scores 0 for demand and 0 for
 * volatility — so Momentum alone, weighted at 0.5, has to be able to reach the hot tier
 * by itself. "Fast movers are watched closely" is the whole thesis; a hot tier a fast
 * mover could only reach with a user's help would be a hot tier nothing ever reaches.
 */
const HOT_PRIORITY = 0.45;
const WARM_PRIORITY = 0.15;

/**
 * What an unmeasured input is worth. Neither 0 nor 1: a Channel whose Momentum or
 * volatility we could not compute is one we have not measured enough, and the only way
 * to measure it is to crawl it. Scoring it 0 would starve it of the crawls that would
 * make it measurable — a Channel would be watched rarely *because* we knew nothing
 * about it, which is exactly backwards.
 */
const UNKNOWN = 0.5;

/** How the three inputs trade off against each other. They sum to 1. */
const WEIGHTS = { momentum: 0.5, demand: 0.3, volatility: 0.2 } as const;

/** How many Snapshots back volatility is measured over. */
export const VOLATILITY_WINDOW = 5;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * How much a stat moved, as a fraction of where it was. A stat that was zero and still
 * is has not moved (0); one that grew from zero is as surprising as we can say (1).
 *
 * Absolute, never signed: a Channel that lost 10% of its subscribers surprised us
 * exactly as much as one that gained 10%. Volatility asks how well we can predict a
 * Channel, not how well the Channel is doing — that is Momentum's job.
 */
function relativeChange(before: number, after: number): number {
	if (before === 0) {
		return after === 0 ? 0 : 1;
	}
	return Math.abs(after - before) / before;
}

/** A Channel Snapshot, as volatility reads it: what we measured, and when. */
export type TakenStats = ChannelStats & { takenAt: number };

/**
 * How fast a Channel's stats move — its drift **per day**, from its Channel Snapshots,
 * oldest first.
 *
 * Per day, and not per Snapshot, because the gap between two Snapshots is itself a
 * function of this number: a cold Channel is crawled every 7 days and a hot one every 6
 * hours, so raw Snapshot-to-Snapshot change would find the cold Channel moving 28× more
 * and promote it for the crime of having been ignored. That feedback loop would make
 * volatility a measure of how rarely we crawl. A rate is the only reading the scheduler
 * cannot bias.
 *
 * `undefined` with fewer than two Snapshots, never 0: a change is a fact about two
 * Snapshots subtracted, and a Channel we have only measured once has not been seen to
 * sit still. Reporting 0 would claim we had watched it hold steady when we had not
 * watched it at all.
 */
export function computeVolatility(
	history: readonly TakenStats[],
): number | undefined {
	// Only the newest Snapshots: volatility is a claim about how a Channel behaves *now*,
	// and one that thrashed a year ago and has been placid since is a placid Channel.
	const window = history.slice(-VOLATILITY_WINDOW);

	const dailyMoves: number[] = [];
	for (let i = 1; i < window.length; i++) {
		const before = window[i - 1] as TakenStats;
		const after = window[i] as TakenStats;
		const days = (after.takenAt - before.takenAt) / DAY;
		if (days <= 0) {
			// Two crawls inside the same instant are one measurement, not a rate.
			continue;
		}
		const moved =
			(relativeChange(before.subscriberCount, after.subscriberCount) +
				relativeChange(before.totalViewCount, after.totalViewCount)) /
			2;
		dailyMoves.push(moved / days);
	}

	if (dailyMoves.length === 0) {
		return undefined;
	}
	return (
		dailyMoves.reduce((total, move) => total + move, 0) / dailyMoves.length
	);
}

/**
 * Everything Refresh priority is a function of, and nothing else. Each may be absent,
 * and absent is not zero — see `UNKNOWN`. A Channel with no `demand` recorded is the
 * exception: nobody has saved a Niche that matches it, so nobody is waiting on its
 * Freshness, and that is a measurement, not a gap.
 */
export type PriorityInputs = {
	/** The Channel's Momentum, absent if the last crawl could not compute one. */
	momentum?: number;
	/** How many saved Niches the Channel appears in. */
	demand?: number;
	/** Its daily drift, absent until it has two Channel Snapshots. */
	volatility?: number;
};

/**
 * How closely a Channel should be watched, from 0 (as rarely as we watch anything) to
 * 1 (as closely as we watch anything).
 *
 * Bounded on purpose. Each input saturates before it is weighed, so a single Channel
 * with a freak 500× Momentum cannot outbid the whole index and eat the day's Crawl
 * Budget by itself. The queue has to stay a queue.
 */
export function refreshPriority({
	momentum,
	demand,
	volatility,
}: PriorityInputs): number {
	// A Momentum of 1 is a Channel performing exactly at its own lifetime average — the
	// flat Channel this scale starts from. Below that it is cooling, and there is nothing
	// to watch closely.
	const momentumScore =
		momentum === undefined
			? UNKNOWN
			: clamp01((momentum - 1) / (RUNAWAY_MOMENTUM - 1));
	const demandScore = clamp01((demand ?? 0) / SATURATING_DEMAND);
	const volatilityScore =
		volatility === undefined
			? UNKNOWN
			: clamp01(volatility / SURPRISING_DAILY_CHANGE);

	return (
		WEIGHTS.momentum * momentumScore +
		WEIGHTS.demand * demandScore +
		WEIGHTS.volatility * volatilityScore
	);
}

/**
 * How long a Channel of this priority may go unread — the whole point of computing a
 * priority at all.
 *
 * Three tiers rather than a continuous curve, because a tier is explainable ("we read
 * this Channel every 6 hours because users saved it and it is moving") and a curve is
 * not. The tier is what makes a high-Momentum Channel Refreshed four times as often as
 * a flat one: it comes due four times as often.
 */
export function refreshIntervalMs(priority: number): number {
	if (priority >= HOT_PRIORITY) {
		return HOT_REFRESH_INTERVAL_MS;
	}
	if (priority >= WARM_PRIORITY) {
		return WARM_REFRESH_INTERVAL_MS;
	}
	return COLD_REFRESH_INTERVAL_MS;
}

/**
 * When a Channel next comes due, and the priority that earned it that place.
 *
 * The one place a Channel's position in the crawl queue is decided, so that the two
 * moments it moves — a crawl that has just read it, and a claim that is about to try —
 * cannot drift apart.
 */
export function scheduleRefresh(
	channel: PriorityInputs,
	now: number,
): { refreshPriority: number; refreshDueAt: number } {
	const priority = refreshPriority(channel);
	return {
		refreshPriority: priority,
		refreshDueAt: now + refreshIntervalMs(priority),
	};
}
