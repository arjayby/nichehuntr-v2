import { describe, expect, it } from "vitest";
import {
	COLD_REFRESH_INTERVAL_MS,
	computeVolatility,
	HOT_REFRESH_INTERVAL_MS,
	refreshIntervalMs,
	refreshPriority,
	type TakenStats,
} from "./priority";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();

/** A Channel Snapshot taken `daysAgo` days ago. */
const taken = (
	daysAgo: number,
	subscriberCount: number,
	totalViewCount: number,
): TakenStats => ({
	subscriberCount,
	totalViewCount,
	videoCount: 100,
	takenAt: NOW - daysAgo * DAY,
});

describe("computeVolatility", () => {
	it("is undefined for a Channel we have only measured once", () => {
		// One Snapshot is not a change. A Channel we have never seen move has not been
		// seen to sit still either, and saying "0" would claim we had.
		expect(computeVolatility([taken(1, 12_000, 4_000_000)])).toBeUndefined();
	});

	it("is zero for a Channel that never surprises us", () => {
		expect(
			computeVolatility([
				taken(3, 12_000, 4_000_000),
				taken(2, 12_000, 4_000_000),
				taken(1, 12_000, 4_000_000),
			]),
		).toBe(0);
	});

	it("rises with the size of the moves between Snapshots", () => {
		const steady = computeVolatility([
			taken(1, 10_000, 1_000_000),
			taken(0, 10_100, 1_010_000),
		]) as number;
		const jumpy = computeVolatility([
			taken(1, 10_000, 1_000_000),
			taken(0, 20_000, 2_000_000),
		]) as number;

		expect(jumpy).toBeGreaterThan(steady);
	});

	it("measures how much a Channel moves, not which way", () => {
		// A Channel that lost 10% of its views surprised us exactly as much as one that
		// gained 10%. Volatility asks how well we can predict it, not how it is doing.
		const gained = computeVolatility([
			taken(1, 10_000, 1_000_000),
			taken(0, 11_000, 1_100_000),
		]);
		const lost = computeVolatility([
			taken(1, 10_000, 1_000_000),
			taken(0, 9_000, 900_000),
		]);

		expect(lost).toBeCloseTo(gained as number);
	});

	it("measures a rate, so crawling a Channel rarely cannot make it look volatile", () => {
		// The trap this exists to avoid: the gap between two Snapshots is set by the
		// interval volatility itself earned the Channel. Measured per Snapshot rather than
		// per day, a Channel crawled weekly would show seven times the drift of the same
		// Channel crawled daily — and volatility would be measuring how rarely we look.
		const crawledDaily = computeVolatility([
			taken(2, 10_000, 1_000_000),
			taken(1, 10_100, 1_010_000),
			taken(0, 10_201, 1_020_100),
		]) as number;
		const crawledWeekly = computeVolatility([
			taken(14, 10_000, 1_000_000),
			taken(7, 10_721, 1_072_135),
			taken(0, 11_494, 1_149_474),
		]) as number;

		// The same 1% a day, seen through two crawl schedules.
		expect(crawledWeekly).toBeCloseTo(crawledDaily, 3);
	});

	it("calls a Channel that had nothing and still has nothing unsurprising", () => {
		// There is no relative change to divide out of nothing. Dividing anyway would make
		// an empty Channel infinitely volatile — the opposite of what we saw.
		expect(computeVolatility([taken(1, 0, 0), taken(0, 0, 0)])).toBe(0);
	});

	it("counts a Channel that went from nothing to something as a full surprise", () => {
		expect(computeVolatility([taken(1, 0, 0), taken(0, 500, 100_000)])).toBe(1);
	});

	it("is undefined when two crawls landed in the same instant", () => {
		// No time passed, so there is no rate to speak of — and dividing by it would report
		// an infinitely volatile Channel on the strength of a duplicate crawl.
		expect(
			computeVolatility([
				taken(0, 10_000, 1_000_000),
				taken(0, 12_000, 1_200_000),
			]),
		).toBeUndefined();
	});
});

describe("refreshPriority", () => {
	const flat = { momentum: 1, demand: 0, volatility: 0 };

	it("watches a fast mover more closely than a flat Channel", () => {
		expect(refreshPriority({ ...flat, momentum: 8 })).toBeGreaterThan(
			refreshPriority(flat),
		);
	});

	it("watches a Channel users have saved more closely than one nobody asked for", () => {
		expect(refreshPriority({ ...flat, demand: 5 })).toBeGreaterThan(
			refreshPriority(flat),
		);
	});

	it("watches a Channel that never surprises us rarely", () => {
		expect(refreshPriority({ ...flat, volatility: 0.5 })).toBeGreaterThan(
			refreshPriority(flat),
		);
	});

	it("does not let one runaway input crowd out the others", () => {
		// A Channel nobody saved, that never moves, cannot claim the whole crawl queue on
		// Momentum alone — priority is bounded, so the queue stays a queue.
		const runaway = refreshPriority({
			momentum: 10_000,
			demand: 10_000,
			volatility: 10_000,
		});

		expect(runaway).toBeLessThanOrEqual(1);
		expect(refreshPriority(flat)).toBeGreaterThanOrEqual(0);
	});

	it("does not punish a Channel for history we have not taken yet", () => {
		// An unknown Momentum or volatility means we have not measured it, not that it is
		// zero. A Channel crawled once must be crawled again to become measurable at all,
		// so it is watched no less closely than one we know to be dull.
		const unknown = refreshPriority({
			momentum: undefined,
			demand: 0,
			volatility: undefined,
		});

		expect(unknown).toBeGreaterThan(refreshPriority(flat));
	});
});

describe("refreshIntervalMs", () => {
	it("comes back to a high-priority Channel sooner than a low-priority one", () => {
		expect(refreshIntervalMs(1)).toBeLessThan(refreshIntervalMs(0));
	});

	it("never leaves a Channel unread for longer than the coldest interval", () => {
		expect(refreshIntervalMs(0)).toBe(COLD_REFRESH_INTERVAL_MS);
		expect(refreshIntervalMs(1)).toBe(HOT_REFRESH_INTERVAL_MS);
	});

	it("never crawls a Channel faster than the hottest interval", () => {
		// The interval is what the budget is actually spent on: an unbounded priority would
		// let one Channel eat the day.
		expect(refreshIntervalMs(1000)).toBe(HOT_REFRESH_INTERVAL_MS);
	});

	it("gives the closest watch to a fast mover nobody has saved and nothing else", () => {
		// The tiers have to be reachable by the score a real Channel can actually earn. On
		// day one no Niche has been saved and no Channel has moved for us yet, so if
		// Momentum alone could not buy the hot tier, "fast movers are watched closely" —
		// the whole thesis — would be a tier nothing in the index ever reached.
		const fastMover = refreshPriority({
			momentum: 8,
			demand: 0,
			volatility: 0,
		});

		expect(refreshIntervalMs(fastMover)).toBe(HOT_REFRESH_INTERVAL_MS);
	});

	it("leaves a Channel that does nothing and that nobody wants in the cold tier", () => {
		expect(
			refreshIntervalMs(
				refreshPriority({ momentum: 1, demand: 0, volatility: 0 }),
			),
		).toBe(COLD_REFRESH_INTERVAL_MS);
	});
});
