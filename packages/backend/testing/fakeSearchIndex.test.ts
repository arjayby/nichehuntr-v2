import { describe, expect, it } from "vitest";
import type { SearchDocument } from "../convex/search/searchIndex";
import { aSearchDocument as aDocument } from "./channelFixtures";
import { createFakeSearchIndex } from "./fakeSearchIndex";

const ids = (documents: SearchDocument[]) =>
	documents.map((document) => document.youtubeChannelId);

/** Queries the given documents, returning the ids that came back in order. */
const search = async (
	documents: SearchDocument[],
	query: Parameters<ReturnType<typeof createFakeSearchIndex>["query"]>[0],
) => {
	const index = createFakeSearchIndex();
	await index.upsert(documents);
	const result = await index.query(query);
	return { ids: ids(result.documents), found: result.found };
};

describe("createFakeSearchIndex — keyword", () => {
	it("matches a Channel on its title", async () => {
		const { ids } = await search(
			[
				aDocument({ youtubeChannelId: "UC_bonsai", title: "Bonsai Hours" }),
				aDocument({
					youtubeChannelId: "UC_woodwork",
					title: "Woodwork Weekly",
				}),
			],
			{ keyword: "bonsai" },
		);
		expect(ids).toEqual(["UC_bonsai"]);
	});

	it("matches a Channel on its description", async () => {
		const { ids } = await search(
			[
				aDocument({
					youtubeChannelId: "UC_bonsai",
					title: "Bonsai Hours",
					description: "Slow television for small trees.",
				}),
				aDocument({
					youtubeChannelId: "UC_woodwork",
					title: "Woodwork Weekly",
					description: "Sawdust and joinery.",
				}),
			],
			{ keyword: "trees" },
		);
		expect(ids).toEqual(["UC_bonsai"]);
	});

	it("matches a Channel on one of its Video titles, though Videos are not searched directly", async () => {
		const { ids } = await search(
			[
				aDocument({
					youtubeChannelId: "UC_bonsai",
					title: "Bonsai Hours",
					description: "Slow television for small trees.",
					videoTitles: ["Repotting a 40-year-old juniper"],
				}),
				aDocument({
					youtubeChannelId: "UC_woodwork",
					title: "Woodwork Weekly",
					description: "Sawdust and joinery.",
					videoTitles: ["Building a dovetail drawer"],
				}),
			],
			{ keyword: "juniper" },
		);
		expect(ids).toEqual(["UC_bonsai"]);
	});

	it("requires every token of a multi-word keyword to appear", async () => {
		const { ids } = await search(
			[
				aDocument({
					youtubeChannelId: "UC_both",
					title: "Bonsai juniper care",
					description: "",
					videoTitles: [],
				}),
				aDocument({
					youtubeChannelId: "UC_one",
					title: "Bonsai basics",
					description: "",
					videoTitles: [],
				}),
			],
			{ keyword: "bonsai juniper" },
		);
		expect(ids).toEqual(["UC_both"]);
	});

	it("matches case-insensitively", async () => {
		const { ids } = await search([aDocument({ title: "Bonsai Hours" })], {
			keyword: "BONSAI",
		});
		expect(ids).toEqual(["UC_bonsai"]);
	});

	it("matches every Channel when no keyword is given", async () => {
		const { ids, found } = await search(
			[
				aDocument({ youtubeChannelId: "UC_a" }),
				aDocument({ youtubeChannelId: "UC_b" }),
			],
			{},
		);
		expect(ids.sort()).toEqual(["UC_a", "UC_b"]);
		expect(found).toBe(2);
	});
});

describe("createFakeSearchIndex — ranges", () => {
	it("keeps only Channels whose field falls inside an inclusive range", async () => {
		const { ids } = await search(
			[
				aDocument({ youtubeChannelId: "UC_small", subscriberCount: 5_000 }),
				aDocument({ youtubeChannelId: "UC_mid", subscriberCount: 20_000 }),
				aDocument({ youtubeChannelId: "UC_big", subscriberCount: 100_000 }),
			],
			{ ranges: { subscriberCount: { min: 10_000, max: 50_000 } } },
		);
		expect(ids).toEqual(["UC_mid"]);
	});

	it("treats each bound as optional", async () => {
		const { ids } = await search(
			[
				aDocument({ youtubeChannelId: "UC_small", subscriberCount: 5_000 }),
				aDocument({ youtubeChannelId: "UC_big", subscriberCount: 100_000 }),
			],
			{ ranges: { subscriberCount: { min: 10_000 } } },
		);
		expect(ids).toEqual(["UC_big"]);
	});

	it("excludes a Channel that lacks the field a range filters on", async () => {
		// A range over a Signal is a claim an unmeasured Channel cannot meet: "momentum at
		// least 1" must not admit a Channel whose momentum is unknown.
		const { ids } = await search(
			[
				aDocument({ youtubeChannelId: "UC_hot", momentum: 2.5 }),
				aDocument({ youtubeChannelId: "UC_unknown", momentum: undefined }),
			],
			{ ranges: { momentum: { min: 1 } } },
		);
		expect(ids).toEqual(["UC_hot"]);
	});

	it("applies every range together", async () => {
		const { ids } = await search(
			[
				aDocument({
					youtubeChannelId: "UC_pass",
					subscriberCount: 20_000,
					momentum: 3,
				}),
				aDocument({
					youtubeChannelId: "UC_wrongSubs",
					subscriberCount: 200_000,
					momentum: 3,
				}),
				aDocument({
					youtubeChannelId: "UC_wrongMomentum",
					subscriberCount: 20_000,
					momentum: 0.5,
				}),
			],
			{
				ranges: {
					subscriberCount: { max: 50_000 },
					momentum: { min: 1 },
				},
			},
		);
		expect(ids).toEqual(["UC_pass"]);
	});
});

describe("createFakeSearchIndex — sort", () => {
	it("orders by a single field, descending", async () => {
		const { ids } = await search(
			[
				aDocument({ youtubeChannelId: "UC_mid", momentum: 2 }),
				aDocument({ youtubeChannelId: "UC_hot", momentum: 5 }),
				aDocument({ youtubeChannelId: "UC_cold", momentum: 1 }),
			],
			{ sort: [{ field: "momentum", direction: "desc" }] },
		);
		expect(ids).toEqual(["UC_hot", "UC_mid", "UC_cold"]);
	});

	it("orders by a single field, ascending", async () => {
		const { ids } = await search(
			[
				aDocument({ youtubeChannelId: "UC_mid", medianViewsPerVideo: 20_000 }),
				aDocument({ youtubeChannelId: "UC_big", medianViewsPerVideo: 90_000 }),
				aDocument({ youtubeChannelId: "UC_small", medianViewsPerVideo: 5_000 }),
			],
			{ sort: [{ field: "medianViewsPerVideo", direction: "asc" }] },
		);
		expect(ids).toEqual(["UC_small", "UC_mid", "UC_big"]);
	});

	it("breaks ties on the next sort key", async () => {
		const { ids } = await search(
			[
				aDocument({
					youtubeChannelId: "UC_a",
					momentum: 2,
					medianViewsPerVideo: 10_000,
				}),
				aDocument({
					youtubeChannelId: "UC_b",
					momentum: 2,
					medianViewsPerVideo: 30_000,
				}),
				aDocument({
					youtubeChannelId: "UC_c",
					momentum: 5,
					medianViewsPerVideo: 1_000,
				}),
			],
			{
				sort: [
					{ field: "momentum", direction: "desc" },
					{ field: "medianViewsPerVideo", direction: "desc" },
				],
			},
		);
		expect(ids).toEqual(["UC_c", "UC_b", "UC_a"]);
	});

	it("orders an absent value at the favourable end, so an unmeasured Channel never sorts below one that declined", async () => {
		// The guarantee growth.ts leans on: an absent Growth must not sort below a Channel
		// the index watched shrink. Sorting "most subscribers gained first", the unmeasured
		// Channel goes to the favourable end — never beneath the Channel that lost
		// subscribers — the placement the real engine can express too.
		const { ids } = await search(
			[
				aDocument({ youtubeChannelId: "UC_grew", subscribersGained30d: 1_000 }),
				aDocument({
					youtubeChannelId: "UC_unknown",
					subscribersGained30d: undefined,
				}),
				aDocument({
					youtubeChannelId: "UC_shrank",
					subscribersGained30d: -500,
				}),
			],
			{ sort: [{ field: "subscribersGained30d", direction: "desc" }] },
		);
		expect(ids).toEqual(["UC_unknown", "UC_grew", "UC_shrank"]);
	});

	it("keeps an absent value at the favourable end when sorting ascending too", async () => {
		// Ascending, the favourable end is the bottom of the list, so an unmeasured Channel
		// still never falls below the one that declined.
		const { ids } = await search(
			[
				aDocument({ youtubeChannelId: "UC_grew", subscribersGained30d: 1_000 }),
				aDocument({
					youtubeChannelId: "UC_unknown",
					subscribersGained30d: undefined,
				}),
				aDocument({
					youtubeChannelId: "UC_shrank",
					subscribersGained30d: -500,
				}),
			],
			{ sort: [{ field: "subscribersGained30d", direction: "asc" }] },
		);
		expect(ids).toEqual(["UC_shrank", "UC_grew", "UC_unknown"]);
	});
});

describe("createFakeSearchIndex — Entry Bar", () => {
	it("returns only searchable Channels by default", async () => {
		const { ids, found } = await search(
			[
				aDocument({ youtubeChannelId: "UC_in", meetsEntryBar: true }),
				aDocument({ youtubeChannelId: "UC_out", meetsEntryBar: false }),
			],
			{},
		);
		expect(ids).toEqual(["UC_in"]);
		expect(found).toBe(1);
	});

	it("can be asked for flagged Channels too", async () => {
		const { ids } = await search(
			[
				aDocument({ youtubeChannelId: "UC_in", meetsEntryBar: true }),
				aDocument({ youtubeChannelId: "UC_out", meetsEntryBar: false }),
			],
			{ meetsEntryBar: false },
		);
		expect(ids.sort()).toEqual(["UC_in", "UC_out"]);
	});
});

describe("createFakeSearchIndex — pagination", () => {
	it("returns a page of results and the total that matched", async () => {
		const documents = Array.from({ length: 5 }, (_, i) =>
			aDocument({
				youtubeChannelId: `UC_${i}`,
				medianViewsPerVideo: (i + 1) * 1_000,
			}),
		);
		const index = createFakeSearchIndex();
		await index.upsert(documents);

		const result = await index.query({
			sort: [{ field: "medianViewsPerVideo", direction: "asc" }],
			offset: 1,
			limit: 2,
		});

		expect(ids(result.documents)).toEqual(["UC_1", "UC_2"]);
		expect(result.found).toBe(5);
	});
});

describe("createFakeSearchIndex — upsert", () => {
	it("replaces a document with the same id rather than duplicating it", async () => {
		const index = createFakeSearchIndex();
		await index.upsert([aDocument({ title: "Bonsai Hours" })]);
		await index.upsert([aDocument({ title: "Bonsai Hours Renamed" })]);

		const result = await index.query({ keyword: "renamed" });
		expect(ids(result.documents)).toEqual(["UC_bonsai"]);
		expect(result.found).toBe(1);
	});
});
