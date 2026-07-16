/**
 * The user-facing Channel search: keyword, several simultaneous numeric ranges, an arbitrary
 * sort, and a page — the canonical nichehuntr query, and the one Convex cannot express (see
 * `docs/adr/0001-external-search-engine-for-channel-search.md`).
 *
 * These run against the in-memory fake, which mirrors the real engine exactly on the two
 * semantics this surface is made of — inclusive numeric ranges and multi-field sort with
 * missing values at the favourable end — so what passes here is the search production runs.
 */
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it } from "vitest";
import { aSearchDocument } from "../testing/channelFixtures";
import { createFakeSearchIndex } from "../testing/fakeSearchIndex";
import { api } from "./_generated/api";
import { signalsValidator } from "./discovery/signals";
import { growthValidator } from "./growth";
import schema from "./schema";
import type { SearchDocument } from "./search/searchIndex";
import { SORTABLE_FIELDS, setSearchIndex } from "./search/searchIndex";

const modules = import.meta.glob("./**/*.*s");

/** Stands up a Convex test with the given Channels already projected into the engine. */
const setup = async (documents: SearchDocument[]) => {
	const search = createFakeSearchIndex();
	await search.upsert(documents);
	setSearchIndex(search);
	return convexTest(schema, modules);
};

afterEach(() => {
	setSearchIndex(null);
});

const ids = (result: { channels: SearchDocument[] }) =>
	result.channels.map((channel) => channel.youtubeChannelId);

describe("filtering by numeric range", () => {
	it("keeps only Channels inside an inclusive range", async () => {
		const t = await setup([
			aSearchDocument({ youtubeChannelId: "UC_small", subscriberCount: 5_000 }),
			aSearchDocument({ youtubeChannelId: "UC_mid", subscriberCount: 20_000 }),
			aSearchDocument({ youtubeChannelId: "UC_big", subscriberCount: 500_000 }),
		]);

		const result = await t.action(api.search.channels.searchChannels, {
			filters: { subscriberCount: { min: 10_000, max: 200_000 } },
		});

		expect(ids(result)).toEqual(["UC_mid"]);
	});

	it("combines several ranges in a single query", async () => {
		// The reason an external engine exists at all: several simultaneous numeric ranges,
		// which no Convex index expresses.
		const t = await setup([
			aSearchDocument({
				youtubeChannelId: "UC_pass",
				subscriberCount: 50_000,
				shortsViewShare: 0.9,
				momentum: 3,
			}),
			aSearchDocument({
				youtubeChannelId: "UC_tooBig",
				subscriberCount: 900_000,
				shortsViewShare: 0.9,
				momentum: 3,
			}),
			aSearchDocument({
				youtubeChannelId: "UC_notShorts",
				subscriberCount: 50_000,
				shortsViewShare: 0.2,
				momentum: 3,
			}),
			aSearchDocument({
				youtubeChannelId: "UC_cold",
				subscriberCount: 50_000,
				shortsViewShare: 0.9,
				momentum: 0.4,
			}),
		]);

		const result = await t.action(api.search.channels.searchChannels, {
			filters: {
				subscriberCount: { min: 10_000, max: 200_000 },
				shortsViewShare: { min: 0.7 },
				momentum: { min: 2 },
			},
		});

		expect(ids(result)).toEqual(["UC_pass"]);
	});

	it("filters on every Signal the issue names, not just the raw stats", async () => {
		const t = await setup([
			aSearchDocument({
				youtubeChannelId: "UC_match",
				totalViewCount: 4_000_000,
				shortsUploadShare: 0.8,
				uploadCadencePerWeek: 5,
				channelAgeDays: 120,
				viewsPerSubscriber: 300,
			}),
			aSearchDocument({
				youtubeChannelId: "UC_old",
				totalViewCount: 4_000_000,
				shortsUploadShare: 0.8,
				uploadCadencePerWeek: 5,
				channelAgeDays: 3_000,
				viewsPerSubscriber: 300,
			}),
		]);

		const result = await t.action(api.search.channels.searchChannels, {
			filters: {
				totalViewCount: { min: 1_000_000 },
				shortsUploadShare: { min: 0.5 },
				uploadCadencePerWeek: { min: 3 },
				channelAgeDays: { max: 365 },
				viewsPerSubscriber: { min: 100 },
			},
		});

		expect(ids(result)).toEqual(["UC_match"]);
	});

	it("excludes a Channel whose filtered Signal was never measured", async () => {
		// "Momentum at least 2" is a claim an unmeasured Channel cannot meet.
		const t = await setup([
			aSearchDocument({ youtubeChannelId: "UC_hot", momentum: 3 }),
			aSearchDocument({ youtubeChannelId: "UC_unknown", momentum: undefined }),
		]);

		const result = await t.action(api.search.channels.searchChannels, {
			filters: { momentum: { min: 2 } },
		});

		expect(ids(result)).toEqual(["UC_hot"]);
	});
});

describe("sorting", () => {
	it("sorts by a Signal, descending", async () => {
		const t = await setup([
			aSearchDocument({ youtubeChannelId: "UC_mid", momentum: 2 }),
			aSearchDocument({ youtubeChannelId: "UC_hot", momentum: 5 }),
			aSearchDocument({ youtubeChannelId: "UC_cold", momentum: 1 }),
		]);

		const result = await t.action(api.search.channels.searchChannels, {
			sort: [{ field: "momentum", direction: "desc" }],
		});

		expect(ids(result)).toEqual(["UC_hot", "UC_mid", "UC_cold"]);
	});

	it("sorts by a Signal, ascending", async () => {
		const t = await setup([
			aSearchDocument({ youtubeChannelId: "UC_busy", uploadCadencePerWeek: 7 }),
			aSearchDocument({ youtubeChannelId: "UC_calm", uploadCadencePerWeek: 1 }),
			aSearchDocument({ youtubeChannelId: "UC_mid", uploadCadencePerWeek: 3 }),
		]);

		// Ascending Upload Cadence is a real question: "which niche demands least of me?"
		const result = await t.action(api.search.channels.searchChannels, {
			sort: [{ field: "uploadCadencePerWeek", direction: "asc" }],
		});

		expect(ids(result)).toEqual(["UC_calm", "UC_mid", "UC_busy"]);
	});

	it("sorts by every Signal the issue offers, in both directions", async () => {
		// Two Channels per Signal, so this proves each Signal actually *orders* results rather
		// than merely being a name the validator accepts.
		for (const field of [
			"momentum",
			"viewsPerSubscriber",
			"medianViewsPerVideo",
			"outlierRatio",
			"uploadCadencePerWeek",
			"channelAgeDays",
		] as const) {
			const t = await setup([
				aSearchDocument({ youtubeChannelId: "UC_low", [field]: 1 }),
				aSearchDocument({ youtubeChannelId: "UC_high", [field]: 100 }),
			]);

			const descending = await t.action(api.search.channels.searchChannels, {
				sort: [{ field, direction: "desc" }],
			});
			expect(ids(descending), `${field} descending`).toEqual([
				"UC_high",
				"UC_low",
			]);

			const ascending = await t.action(api.search.channels.searchChannels, {
				sort: [{ field, direction: "asc" }],
			});
			expect(ids(ascending), `${field} ascending`).toEqual([
				"UC_low",
				"UC_high",
			]);
		}
	});

	it("breaks ties on the next sort key", async () => {
		const t = await setup([
			aSearchDocument({
				youtubeChannelId: "UC_a",
				momentum: 2,
				outlierRatio: 4,
			}),
			aSearchDocument({
				youtubeChannelId: "UC_b",
				momentum: 2,
				outlierRatio: 9,
			}),
			aSearchDocument({
				youtubeChannelId: "UC_c",
				momentum: 5,
				outlierRatio: 1,
			}),
		]);

		const result = await t.action(api.search.channels.searchChannels, {
			sort: [
				{ field: "momentum", direction: "desc" },
				{ field: "outlierRatio", direction: "desc" },
			],
		});

		expect(ids(result)).toEqual(["UC_c", "UC_b", "UC_a"]);
	});

	it("never sorts a Channel with an unmeasured Signal as the worst", async () => {
		// The guarantee signals.ts and growth.ts both lean on: an absent Signal means "there
		// was nothing to look at", not "this Channel scored nothing". Sorting by Momentum
		// descending, the unmeasured Channel must not fall below the one we watched cool off.
		const t = await setup([
			aSearchDocument({ youtubeChannelId: "UC_hot", momentum: 5 }),
			aSearchDocument({ youtubeChannelId: "UC_unknown", momentum: undefined }),
			aSearchDocument({ youtubeChannelId: "UC_declining", momentum: 0.2 }),
		]);

		const result = await t.action(api.search.channels.searchChannels, {
			sort: [{ field: "momentum", direction: "desc" }],
		});

		expect(ids(result)).toEqual(["UC_unknown", "UC_hot", "UC_declining"]);
	});

	it("still does not rank an unmeasured Channel worst when the sort is ascending", async () => {
		// Ascending, an absent Signal goes to the *end* of the list. That is still "not the
		// worst", because every Signal that can be absent is one where a higher number is the
		// better Channel: sorting Views per Subscriber ascending asks for the weakest first, so
		// the bottom is the strong end, and the unmeasured Channel is not being called weak.
		// See `SearchQuery.sort` — the invariant this rests on is that the two Signals where
		// lower is better (Upload Cadence, Channel Age) are required and so never absent.
		const t = await setup([
			aSearchDocument({
				youtubeChannelId: "UC_strong",
				viewsPerSubscriber: 500,
			}),
			aSearchDocument({
				youtubeChannelId: "UC_unknown",
				viewsPerSubscriber: undefined,
			}),
			aSearchDocument({ youtubeChannelId: "UC_weak", viewsPerSubscriber: 2 }),
		]);

		const result = await t.action(api.search.channels.searchChannels, {
			sort: [{ field: "viewsPerSubscriber", direction: "asc" }],
		});

		// The weakest Channel leads, as asked; the unmeasured one is not sitting among the
		// weak Channels pretending we measured it and found it wanting.
		expect(ids(result)).toEqual(["UC_weak", "UC_strong", "UC_unknown"]);
		expect(ids(result)[0]).not.toBe("UC_unknown");
	});

	it("never sorts a Channel with no Growth history below one that shrank", async () => {
		// growth.ts states this requirement explicitly: an absent Growth says "we have not
		// watched this Channel long enough to say", not "this Channel did not grow".
		const t = await setup([
			aSearchDocument({
				youtubeChannelId: "UC_grew",
				subscribersGained30d: 5_000,
			}),
			aSearchDocument({
				youtubeChannelId: "UC_new",
				subscribersGained30d: undefined,
			}),
			aSearchDocument({
				youtubeChannelId: "UC_shrank",
				subscribersGained30d: -2_000,
			}),
		]);

		const result = await t.action(api.search.channels.searchChannels, {
			sort: [{ field: "subscribersGained30d", direction: "desc" }],
		});

		expect(ids(result)).toEqual(["UC_new", "UC_grew", "UC_shrank"]);
	});
});

describe("raw size is a filter, never a sort", () => {
	// Raw size ranks Channels by how hard they are to compete with — the opposite of the
	// question being asked — so the API must not offer it as a sort at all. The type forbids
	// it at compile time; these prove the deployed function rejects it at runtime too, since
	// a client is not type-checked.
	it("rejects a sort by subscriber count", async () => {
		const t = await setup([aSearchDocument()]);

		// Matched on the validator's own complaint, naming the offending field, so this fails
		// if the call ever starts throwing for some unrelated reason instead.
		await expect(
			t.action(api.search.channels.searchChannels, {
				// @ts-expect-error subscriberCount is not a SortableField — that is the point.
				sort: [{ field: "subscriberCount", direction: "desc" }],
			}),
		).rejects.toThrow(/Validator error[\s\S]*subscriberCount/);
	});

	it("rejects a sort by total view count", async () => {
		const t = await setup([aSearchDocument()]);

		await expect(
			t.action(api.search.channels.searchChannels, {
				// @ts-expect-error totalViewCount is not a SortableField — that is the point.
				sort: [{ field: "totalViewCount", direction: "desc" }],
			}),
		).rejects.toThrow(/Validator error[\s\S]*totalViewCount/);
	});

	it("offers every Signal and Growth Metric as a sort, and nothing else", async () => {
		// The positive half of the ban: proving raw size is rejected is only half an answer if
		// the sort list has quietly lost a Signal too.
		expect([...SORTABLE_FIELDS].sort()).toEqual(
			[
				...Object.keys(signalsValidator.fields),
				...Object.keys(growthValidator.fields),
			].sort(),
		);
		expect(SORTABLE_FIELDS).not.toContain("subscriberCount");
		expect(SORTABLE_FIELDS).not.toContain("totalViewCount");
	});

	it("still filters by raw size", async () => {
		const t = await setup([
			aSearchDocument({ youtubeChannelId: "UC_small", subscriberCount: 900 }),
			aSearchDocument({ youtubeChannelId: "UC_mid", subscriberCount: 20_000 }),
		]);

		const result = await t.action(api.search.channels.searchChannels, {
			filters: { subscriberCount: { min: 10_000 } },
		});

		expect(ids(result)).toEqual(["UC_mid"]);
	});
});

describe("the canonical query", () => {
	/**
	 * The query from the issue, end to end:
	 *
	 *   text "scary stories" AND subscribers 10k–200k AND shortsViewShare > 0.7
	 *   AND momentum > 2.0 SORT BY momentum DESC PAGINATE
	 */
	const scaryStories = [
		aSearchDocument({
			youtubeChannelId: "UC_scary_hot",
			title: "Scary Stories at Midnight",
			subscriberCount: 50_000,
			shortsViewShare: 0.9,
			momentum: 4,
		}),
		aSearchDocument({
			youtubeChannelId: "UC_scary_warm",
			title: "More Scary Stories",
			subscriberCount: 150_000,
			shortsViewShare: 0.8,
			momentum: 2.5,
		}),
		aSearchDocument({
			youtubeChannelId: "UC_scary_mild",
			title: "Scary Stories Nightly",
			subscriberCount: 30_000,
			shortsViewShare: 0.75,
			momentum: 2.1,
		}),
		// Matches the text and the ranges but is too big to be worth entering against.
		aSearchDocument({
			youtubeChannelId: "UC_scary_huge",
			title: "Scary Stories Official",
			subscriberCount: 4_000_000,
			shortsViewShare: 0.9,
			momentum: 9,
		}),
		// Matches every range but is about something else entirely.
		aSearchDocument({
			youtubeChannelId: "UC_bonsai",
			title: "Bonsai Hours",
			description: "Slow television for small trees.",
			videoTitles: [],
			subscriberCount: 50_000,
			shortsViewShare: 0.9,
			momentum: 4,
		}),
	];

	const canonical = {
		keyword: "scary stories",
		filters: {
			subscriberCount: { min: 10_000, max: 200_000 },
			shortsViewShare: { min: 0.7 },
			momentum: { min: 2 },
		},
		sort: [{ field: "momentum", direction: "desc" }],
	} as const;

	it("applies keyword, ranges and sort together", async () => {
		const t = await setup(scaryStories);

		const result = await t.action(api.search.channels.searchChannels, {
			...canonical,
			sort: [...canonical.sort],
		});

		expect(ids(result)).toEqual([
			"UC_scary_hot",
			"UC_scary_warm",
			"UC_scary_mild",
		]);
	});

	it("paginates the sorted matches without losing the total", async () => {
		const t = await setup(scaryStories);

		const first = await t.action(api.search.channels.searchChannels, {
			...canonical,
			sort: [...canonical.sort],
			page: 0,
			pageSize: 2,
		});
		const second = await t.action(api.search.channels.searchChannels, {
			...canonical,
			sort: [...canonical.sort],
			page: 1,
			pageSize: 2,
		});

		expect(ids(first)).toEqual(["UC_scary_hot", "UC_scary_warm"]);
		expect(ids(second)).toEqual(["UC_scary_mild"]);
		// The count is of the criteria, not of the page: this is what tells a user their
		// niche has three Channels in it, which one page of two could never say.
		expect(first.found).toBe(3);
		expect(second.found).toBe(3);
	});

	it("reports a total match count larger than any page", async () => {
		const t = await setup(
			Array.from({ length: 50 }, (_, i) =>
				aSearchDocument({
					youtubeChannelId: `UC_${i}`,
					title: "Scary Stories",
					momentum: i,
					shortsViewShare: 0.9,
					subscriberCount: 50_000,
				}),
			),
		);

		const result = await t.action(api.search.channels.searchChannels, {
			...canonical,
			sort: [...canonical.sort],
			pageSize: 10,
		});

		expect(result.channels).toHaveLength(10);
		expect(result.found).toBe(48); // momentum 2..49 clears `momentum >= 2`
	});
});

describe("the searchable index", () => {
	it("returns only Channels that clear the Entry Bar", async () => {
		const t = await setup([
			aSearchDocument({ youtubeChannelId: "UC_in", meetsEntryBar: true }),
			aSearchDocument({ youtubeChannelId: "UC_out", meetsEntryBar: false }),
		]);

		const result = await t.action(api.search.channels.searchChannels, {});

		expect(ids(result)).toEqual(["UC_in"]);
		expect(result.found).toBe(1);
	});

	it("matches a Channel on its Videos' titles", async () => {
		const t = await setup([
			aSearchDocument({
				youtubeChannelId: "UC_bonsai",
				title: "Bonsai Hours",
				videoTitles: ["Repotting a 40-year-old juniper"],
			}),
			aSearchDocument({
				youtubeChannelId: "UC_woodwork",
				title: "Woodwork Weekly",
				description: "Sawdust and joinery.",
				videoTitles: ["Building a dovetail drawer"],
			}),
		]);

		const result = await t.action(api.search.channels.searchChannels, {
			keyword: "juniper",
		});

		expect(ids(result)).toEqual(["UC_bonsai"]);
	});

	it("treats a filter-and-sort with no keyword as a valid search", async () => {
		const t = await setup([
			aSearchDocument({ youtubeChannelId: "UC_a", momentum: 1 }),
			aSearchDocument({ youtubeChannelId: "UC_b", momentum: 2 }),
		]);

		const result = await t.action(api.search.channels.searchChannels, {
			sort: [{ field: "momentum", direction: "desc" }],
		});

		expect(ids(result)).toEqual(["UC_b", "UC_a"]);
	});
});

describe("page size", () => {
	it("caps a page at the maximum, so one search cannot ask for the whole index", async () => {
		const t = await setup(
			Array.from({ length: 120 }, (_, i) =>
				aSearchDocument({ youtubeChannelId: `UC_${i}` }),
			),
		);

		const result = await t.action(api.search.channels.searchChannels, {
			pageSize: 10_000,
		});

		expect(result.channels).toHaveLength(100);
		expect(result.found).toBe(120);
	});

	it("rejects a page that does not name a page", async () => {
		// Convex numbers are float64, so the validator alone lets these through; a NaN page
		// would otherwise reach the engine as a NaN offset.
		const t = await setup([aSearchDocument()]);

		for (const page of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
			await expect(
				t.action(api.search.channels.searchChannels, { page }),
			).rejects.toThrow(/whole, non-negative page/);
		}
	});

	it("rejects a page too small to hold a Channel", async () => {
		const t = await setup([aSearchDocument()]);

		for (const pageSize of [0, -10, 2.5, Number.NaN]) {
			await expect(
				t.action(api.search.channels.searchChannels, { pageSize }),
			).rejects.toThrow(/at least one Channel/);
		}
	});
});
