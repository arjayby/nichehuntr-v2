import { describe, expect, it } from "vitest";

import {
	activeFilterFields,
	clearFilter,
	EMPTY_CRITERIA,
	FIELD_HELP,
	RANGE_FILTERS,
	SORT_OPTIONS,
	setBound,
	setSort,
	toSearchArgs,
} from "./criteria";

describe("the filters offered", () => {
	it("offers a range control for every filter the product names", () => {
		// The list from the Filters and sorts ticket, verbatim. Raw subscriber and total-view
		// counts belong here — scoping competition level is what they are for.
		expect(RANGE_FILTERS.map((filter) => filter.field)).toEqual([
			"subscriberCount",
			"totalViewCount",
			"momentum",
			"viewsPerSubscriber",
			"shortsUploadShare",
			"shortsViewShare",
			"uploadCadencePerWeek",
			"channelAgeDays",
		]);
	});
});

describe("the sorts offered", () => {
	it("sorts by every Signal, ascending and descending", () => {
		const fields = [...new Set(SORT_OPTIONS.map((option) => option.field))];
		expect(fields).toEqual([
			"momentum",
			"viewsPerSubscriber",
			"medianViewsPerVideo",
			"outlierRatio",
			"uploadCadencePerWeek",
			"channelAgeDays",
			"shortsViewShare",
		]);
		for (const field of fields) {
			const directions = SORT_OPTIONS.filter(
				(option) => option.field === field,
			).map((option) => option.direction);
			expect(directions).toEqual(["desc", "asc"]);
		}
	});

	it("never offers a sort on raw size", () => {
		// Raw size ranks Channels by how hard they are to compete with, which is the opposite of
		// the question being asked. The backend rejects such a sort; the UI must never ask for it.
		const fields = SORT_OPTIONS.map((option) => option.field as string);
		expect(fields).not.toContain("subscriberCount");
		expect(fields).not.toContain("totalViewCount");
	});

	it("labels each sort with what it puts first, not with a field name", () => {
		for (const option of SORT_OPTIONS) {
			expect(option.label).toMatch(/first$/);
		}
	});

	it("leads with Momentum, the Signal that works on day one", () => {
		expect(EMPTY_CRITERIA.sortId).toBe("momentum:desc");
	});
});

describe("turning criteria into a search", () => {
	it("asks for the first page sorted by Momentum when nothing is set", () => {
		expect(toSearchArgs(EMPTY_CRITERIA)).toEqual({
			page: 0,
			sort: [{ field: "momentum", direction: "desc" }],
		});
	});

	it("sends a keyword once one is typed", () => {
		const criteria = { ...EMPTY_CRITERIA, keyword: "scary stories" };
		expect(toSearchArgs(criteria).keyword).toBe("scary stories");
	});

	it("omits a keyword that is only whitespace", () => {
		const criteria = { ...EMPTY_CRITERIA, keyword: "   " };
		expect(toSearchArgs(criteria).keyword).toBeUndefined();
	});

	it("sends a range with both bounds", () => {
		const criteria = setBound(
			setBound(EMPTY_CRITERIA, "subscriberCount", "min", "10000"),
			"subscriberCount",
			"max",
			"200000",
		);
		expect(toSearchArgs(criteria).filters).toEqual({
			subscriberCount: { min: 10_000, max: 200_000 },
		});
	});

	it("sends a half-open range, leaving the untyped side open", () => {
		const criteria = setBound(EMPTY_CRITERIA, "momentum", "min", "2");
		expect(toSearchArgs(criteria).filters).toEqual({ momentum: { min: 2 } });
	});

	it("converts a share typed as a percentage into the ratio the index holds", () => {
		// The user thinks in percent; the engine holds 0–1. A 70 typed here must not filter for
		// a Shorts View Share of 7000%, which would match nothing and look like an empty niche.
		const criteria = setBound(EMPTY_CRITERIA, "shortsViewShare", "min", "70");
		expect(toSearchArgs(criteria).filters).toEqual({
			shortsViewShare: { min: 0.7 },
		});
	});

	it("ignores a bound that is not a number yet", () => {
		// A range control is a text box: "1e", "-" and "" are all things a half-typed number
		// looks like, and none of them is a filter.
		const criteria = setBound(EMPTY_CRITERIA, "momentum", "min", "1e");
		expect(toSearchArgs(criteria).filters).toBeUndefined();
	});

	it("combines several ranges in one search — the canonical query", () => {
		let criteria = { ...EMPTY_CRITERIA, keyword: "scary stories" };
		criteria = setBound(criteria, "subscriberCount", "min", "10000");
		criteria = setBound(criteria, "subscriberCount", "max", "200000");
		criteria = setBound(criteria, "shortsViewShare", "min", "70");
		criteria = setBound(criteria, "momentum", "min", "2");
		criteria = setSort(criteria, "momentum:desc");

		expect(toSearchArgs(criteria)).toEqual({
			keyword: "scary stories",
			filters: {
				subscriberCount: { min: 10_000, max: 200_000 },
				shortsViewShare: { min: 0.7 },
				momentum: { min: 2 },
			},
			sort: [{ field: "momentum", direction: "desc" }],
			page: 0,
		});
	});

	it("sends the sort the user picked", () => {
		const criteria = setSort(EMPTY_CRITERIA, "channelAgeDays:asc");
		expect(toSearchArgs(criteria).sort).toEqual([
			{ field: "channelAgeDays", direction: "asc" },
		]);
	});

	it("refuses a sort nothing offers rather than quietly sorting by something else", () => {
		// The only thing that produces a sort id is a <select> built from SORT_OPTIONS, so an id
		// nothing matches is our bug. Falling back to Momentum would hide it behind a list that
		// looks perfectly fine — and the user would never know they were not sorted as asked.
		expect(() => setSort(EMPTY_CRITERIA, "subscriberCount:desc")).toThrow(
			/no sort is offered/i,
		);
	});
});

describe("the one sentence that explains a field", () => {
	it("says the same thing wherever a field is shown", () => {
		// Every filter reads its sentence from the one place that holds it, so the filter panel
		// and the result row cannot drift into explaining the same Signal two different ways.
		for (const filter of RANGE_FILTERS) {
			expect(filter.help).toBe(FIELD_HELP[filter.field]);
		}
	});

	it("explains every field a user can filter or sort by", () => {
		for (const field of [
			...RANGE_FILTERS.map((filter) => filter.field),
			...SORT_OPTIONS.map((option) => option.field),
		]) {
			expect(FIELD_HELP[field]).toMatch(/\S/);
		}
	});
});

describe("clearing a filter", () => {
	it("drops one filter and leaves the others standing", () => {
		let criteria = setBound(EMPTY_CRITERIA, "subscriberCount", "min", "10000");
		criteria = setBound(criteria, "momentum", "min", "2");

		const cleared = clearFilter(criteria, "momentum");

		expect(toSearchArgs(cleared).filters).toEqual({
			subscriberCount: { min: 10_000 },
		});
	});

	it("returns to page one, because the old page may not exist under a looser filter", () => {
		let criteria = setBound(EMPTY_CRITERIA, "momentum", "min", "2");
		criteria = { ...criteria, page: 4 };

		expect(clearFilter(criteria, "momentum").page).toBe(0);
	});
});

describe("which filters are active", () => {
	it("counts a filter with any bound typed", () => {
		const criteria = setBound(EMPTY_CRITERIA, "momentum", "min", "2");
		expect(activeFilterFields(criteria)).toEqual(["momentum"]);
	});

	it("does not count a filter the user typed into and emptied again", () => {
		let criteria = setBound(EMPTY_CRITERIA, "momentum", "min", "2");
		criteria = setBound(criteria, "momentum", "min", "");
		expect(activeFilterFields(criteria)).toEqual([]);
	});
});

describe("changing a search", () => {
	it("returns to page one whenever the criteria change", () => {
		// Page 5 of one search is not page 5 of another: keeping the page across a change would
		// show an empty page and read as "no matches".
		const onPageFive = { ...EMPTY_CRITERIA, page: 5 };
		expect(setBound(onPageFive, "momentum", "min", "2").page).toBe(0);
		expect(setSort(onPageFive, "channelAgeDays:asc").page).toBe(0);
	});
});
