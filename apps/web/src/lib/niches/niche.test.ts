import type { NicheCriteria } from "@nichehuntr-v2/backend/convex/niches/criteria";
import { describe, expect, it } from "vitest";

import {
	EMPTY_CRITERIA,
	type SearchCriteria,
	setBound,
	setKeyword,
	setSort,
	toSearchArgs,
} from "@/lib/search/criteria";

import { describeNiche, nicheCriteriaFrom, searchCriteriaFrom } from "./niche";

/** The criteria a user builds up on the screen: a keyword, a couple of ranges, a chosen sort. */
const builtCriteria = (): SearchCriteria => {
	let criteria = EMPTY_CRITERIA;
	criteria = setKeyword(criteria, "scary stories");
	criteria = setBound(criteria, "subscriberCount", "min", "10000");
	criteria = setBound(criteria, "subscriberCount", "max", "200000");
	criteria = setBound(criteria, "shortsViewShare", "min", "70");
	criteria = setSort(criteria, "shortsViewShare:desc");
	return criteria;
};

describe("saving the screen's criteria as a Niche", () => {
	it("captures the keyword, the ranges as the index holds them, and the sort", () => {
		const niche = nicheCriteriaFrom(builtCriteria());

		expect(niche).toEqual({
			keyword: "scary stories",
			filters: {
				subscriberCount: { min: 10_000, max: 200_000 },
				// Typed as 70, stored as the 0–1 ratio the index actually filters on.
				shortsViewShare: { min: 0.7 },
			},
			sort: { field: "shortsViewShare", direction: "desc" },
		});
	});

	it("saves the exact search the screen would have run — a Niche never drifts from its query", () => {
		const criteria = builtCriteria();
		const niche = nicheCriteriaFrom(criteria);
		const search = toSearchArgs(criteria);

		expect(niche.keyword).toBe(search.keyword);
		expect(niche.filters).toEqual(search.filters);
		expect([niche.sort]).toEqual(search.sort);
	});

	it("keeps no page — a Niche is a set, not a scroll position in one", () => {
		const criteria = { ...builtCriteria(), page: 4 };
		const niche = nicheCriteriaFrom(criteria);

		expect(niche).not.toHaveProperty("page");
		// And re-opening it lands on page one.
		expect(searchCriteriaFrom(niche).page).toBe(0);
	});
});

describe("re-opening a saved Niche on the screen", () => {
	it("puts every typed bound back in the box it came from, percentages and all", () => {
		const niche = nicheCriteriaFrom(builtCriteria());

		const criteria = searchCriteriaFrom(niche);

		expect(criteria.keyword).toBe("scary stories");
		expect(criteria.filters.subscriberCount).toEqual({
			min: "10000",
			max: "200000",
		});
		// The ratio 0.7 reads back as the 70 the user typed — not 70.00000000000001.
		expect(criteria.filters.shortsViewShare).toEqual({ min: "70", max: "" });
		expect(criteria.sortId).toBe("shortsViewShare:desc");
		expect(criteria.page).toBe(0);
	});

	it("round-trips: saving then re-opening then saving again yields the same Niche", () => {
		const niche = nicheCriteriaFrom(builtCriteria());

		const reopened = nicheCriteriaFrom(searchCriteriaFrom(niche));

		expect(reopened).toEqual(niche);
	});

	it("re-opening a Niche runs the search it stored", () => {
		const niche = nicheCriteriaFrom(builtCriteria());

		// What the screen would send after a Niche is opened is the search the Niche stands for.
		expect(toSearchArgs(searchCriteriaFrom(niche))).toEqual({
			keyword: "scary stories",
			filters: {
				subscriberCount: { min: 10_000, max: 200_000 },
				shortsViewShare: { min: 0.7 },
			},
			sort: [{ field: "shortsViewShare", direction: "desc" }],
			page: 0,
		});
	});

	it("falls back to the default sort rather than throwing on one it no longer offers", () => {
		const niche: NicheCriteria = {
			keyword: "",
			filters: {},
			// A field the sort `<select>` does not offer (a Growth Metric is sortable at the engine
			// but not in the product's sort list).
			sort: { field: "subscribersGained30d", direction: "desc" },
		};

		expect(searchCriteriaFrom(niche).sortId).toBe(EMPTY_CRITERIA.sortId);
	});
});

describe("describing a Niche in a line", () => {
	it("shows the keyword, each filter with its numbers, and what it sorts first", () => {
		const parts = describeNiche(nicheCriteriaFrom(builtCriteria()));

		expect(parts).toContain("“scary stories”");
		expect(parts).toContain("Subscribers: 10,000–200,000 subscribers");
		expect(parts).toContain("Shorts view share: ≥ 70%");
		expect(parts).toContain("Sorted: Most Shorts-driven views first");
	});

	it("omits the keyword line when there is no keyword", () => {
		const niche: NicheCriteria = {
			keyword: "",
			filters: { momentum: { min: 2 } },
			sort: { field: "momentum", direction: "desc" },
		};

		const parts = describeNiche(niche);
		expect(parts.some((part) => part.includes("“"))).toBe(false);
		expect(parts).toContain("Momentum: ≥ 2×");
		expect(parts).toContain("Sorted: Heating up fastest first");
	});

	it("reads a one-sided range as an open end", () => {
		const niche: NicheCriteria = {
			keyword: "",
			filters: { channelAgeDays: { max: 365 } },
			sort: { field: "channelAgeDays", direction: "asc" },
		};

		expect(describeNiche(niche)).toContain("Channel age: ≤ 365 days");
	});
});
