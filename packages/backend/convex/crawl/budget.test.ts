import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import {
	crawlDay,
	DAILY_CRAWL_BUDGET,
	recordCrawlSpend,
	remainingCrawlBudget,
} from "./budget";

// Globbed from the package root, not relatively: convex-test resolves a function by its
// path from `convex/`, and a relative glob in a nested test would not see its own
// directory.
const modules = import.meta.glob("/convex/**/*.*s");

const DAY = 24 * 60 * 60 * 1000;

const setup = () => {
	const t = convexTest(schema, modules);
	return {
		t,
		remaining: (now: number) =>
			t.run((ctx) => remainingCrawlBudget(ctx, { now })),
		spend: (now: number, crawls: number, exhausted = false) =>
			t.run((ctx) => recordCrawlSpend(ctx, { now, crawls, exhausted })),
		today: (now: number) => t.query(internal.crawl.budget.consumption, { now }),
	};
};

describe("Crawl Budget", () => {
	it("starts the day with the whole budget unspent", async () => {
		const { remaining } = setup();

		expect(await remaining(Date.now())).toBe(DAILY_CRAWL_BUDGET);
	});

	it("has less left after crawls are paid for", async () => {
		const now = Date.now();
		const { spend, remaining } = setup();

		await spend(now, 30);
		await spend(now, 20);

		expect(await remaining(now)).toBe(DAILY_CRAWL_BUDGET - 50);
	});

	it("is scarce: it can be spent down to nothing, and no further", async () => {
		const now = Date.now();
		const { spend, remaining } = setup();

		await spend(now, DAILY_CRAWL_BUDGET + 100);

		expect(await remaining(now)).toBe(0);
	});

	it("refills tomorrow, because the quota is a daily one", async () => {
		const now = Date.now();
		const { spend, remaining } = setup();

		await spend(now, DAILY_CRAWL_BUDGET);

		expect(await remaining(now + DAY)).toBe(DAILY_CRAWL_BUDGET);
	});

	it("reports what it has spent and what is left, so we can see the index degrading", async () => {
		const now = Date.now();
		const { spend, today } = setup();

		await spend(now, 200);

		expect(await today(now)).toMatchObject({
			day: crawlDay(now),
			budget: DAILY_CRAWL_BUDGET,
			spent: 200,
			remaining: DAILY_CRAWL_BUDGET - 200,
			exhaustedRuns: 0,
		});
	});

	it("reports a day nothing has been spent on yet", async () => {
		const now = Date.now();
		const { today } = setup();

		expect(await today(now)).toMatchObject({
			spent: 0,
			remaining: DAILY_CRAWL_BUDGET,
			exhaustedRuns: 0,
		});
	});

	it("records every run that ran out of budget with work still due", async () => {
		// The whole reason the ledger exists: Refreshes deferred for want of budget are
		// counted, so we can see Freshness degrading before users do.
		const now = Date.now();
		const { spend, today } = setup();

		await spend(now, DAILY_CRAWL_BUDGET, true);
		await spend(now, 0, true);

		expect(await today(now)).toMatchObject({
			remaining: 0,
			exhaustedRuns: 2,
		});
	});

	it("keeps each day's ledger separately, so a bad day stays visible", async () => {
		const now = Date.now();
		const { spend, today } = setup();

		await spend(now, 400);
		await spend(now + DAY, 10);

		expect(await today(now)).toMatchObject({ spent: 400 });
		expect(await today(now + DAY)).toMatchObject({ spent: 10 });
	});
});
