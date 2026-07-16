import { describe, expect, it } from "vitest";

import { describeFreshness } from "./freshness";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const NOW = Date.UTC(2026, 6, 16, 12, 0, 0);
const agedBy = (age: number) => describeFreshness(NOW - age, NOW);

describe("saying how old a Channel's stats are", () => {
	it("reads a crawl from minutes ago as minutes", () => {
		expect(agedBy(5 * MINUTE).label).toBe("5 minutes ago");
	});

	it("reads a crawl from moments ago as just now, not 0 minutes ago", () => {
		expect(agedBy(20 * 1000).label).toBe("just now");
	});

	it("counts in the largest unit that still says something", () => {
		expect(agedBy(3 * HOUR).label).toBe("3 hours ago");
		expect(agedBy(2 * DAY).label).toBe("2 days ago");
		expect(agedBy(30 * DAY).label).toBe("30 days ago");
	});

	it("says one hour, not 1 hours", () => {
		expect(agedBy(1 * HOUR).label).toBe("1 hour ago");
		expect(agedBy(1 * DAY).label).toBe("1 day ago");
		expect(agedBy(1 * MINUTE).label).toBe("1 minute ago");
	});
});

describe("how much to trust a stat", () => {
	it("calls a recent crawl fresh", () => {
		expect(agedBy(2 * HOUR).tone).toBe("fresh");
		expect(agedBy(2 * DAY).tone).toBe("fresh");
	});

	it("calls a crawl from last week aging", () => {
		expect(agedBy(5 * DAY).tone).toBe("aging");
	});

	it("calls an old crawl stale, so a stale stat is never presented as current", () => {
		// The product may not silently pass off an old number as a current one: a creator acting
		// on a three-week-old view count is making a decision we cannot support.
		expect(agedBy(21 * DAY).tone).toBe("stale");
	});

	it("says plainly what a Freshness means, beyond colouring it", () => {
		// The tone is a colour, and a colour alone is not a claim anyone can read.
		expect(agedBy(21 * DAY).title).toMatch(/stale/i);
		expect(agedBy(1 * HOUR).title).toMatch(/last read/i);
	});
});

describe("a Channel whose Freshness makes no sense", () => {
	it("does not claim a crawl from the future is fresh", () => {
		// Clock skew between our crawler and the browser is real, and "in -3 hours" is not a
		// Freshness. It reads as just now, which is the least misleading thing it could say.
		expect(agedBy(-3 * HOUR).label).toBe("just now");
		expect(agedBy(-3 * HOUR).tone).toBe("fresh");
	});
});
