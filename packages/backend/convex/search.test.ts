import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	aChannel,
	DAY,
	longVideo,
	NOW as now,
	shortVideo,
} from "../testing/channelFixtures";
import {
	createFakeChannelSource,
	type FakeChannel,
} from "../testing/fakeChannelSource";
import { createFakeSearchIndex } from "../testing/fakeSearchIndex";
import { internal } from "./_generated/api";
import { setChannelSource } from "./discovery/channelSource";
import schema from "./schema";
import { setSearchIndex } from "./search/searchIndex";

const modules = import.meta.glob("./**/*.*s");

const setup = (seed: FakeChannel[]) => {
	const source = createFakeChannelSource(seed);
	setChannelSource(source);
	const search = createFakeSearchIndex();
	setSearchIndex(search);
	return { t: convexTest(schema, modules), source, search };
};

afterEach(() => {
	setChannelSource(null);
	setSearchIndex(null);
});

/** The ids a keyword search returns, straight off the projection. */
const searchIds = async (
	search: ReturnType<typeof createFakeSearchIndex>,
	keyword: string,
) => {
	const { documents } = await search.query({ keyword });
	return documents.map((document) => document.youtubeChannelId);
};

describe("projecting a Channel on ingest", () => {
	it("makes the Channel findable by a word in its title", async () => {
		const { t, search } = setup([aChannel()]);

		await t.action(internal.ingestion.ingestChannel, {
			youtubeChannelId: "UC_bonsai",
		});

		expect(await searchIds(search, "bonsai")).toEqual(["UC_bonsai"]);
	});

	it("makes the Channel findable by a word in its description", async () => {
		const { t, search } = setup([
			aChannel({ description: "Slow television for small trees." }),
		]);

		await t.action(internal.ingestion.ingestChannel, {
			youtubeChannelId: "UC_bonsai",
		});

		expect(await searchIds(search, "television")).toEqual(["UC_bonsai"]);
	});

	it("makes the Channel findable by a word in one of its Videos' titles", async () => {
		// Videos are not searched directly, but a niche lives in Video titles: a keyword
		// matching a Channel's Video must find the Channel.
		const { t, search } = setup([
			aChannel({
				videos: [
					{ ...longVideo, title: "Repotting a 40-year-old juniper" },
					shortVideo,
				],
			}),
		]);

		await t.action(internal.ingestion.ingestChannel, {
			youtubeChannelId: "UC_bonsai",
		});

		expect(await searchIds(search, "juniper")).toEqual(["UC_bonsai"]);
	});

	it("projects the Channel's Signals, so a search can sort and filter on them", async () => {
		const { t, search } = setup([aChannel()]);

		await t.action(internal.ingestion.ingestChannel, {
			youtubeChannelId: "UC_bonsai",
		});

		const [channel] = await t.run((ctx) => ctx.db.query("channels").collect());
		const { documents } = await search.query({});
		expect(documents).toHaveLength(1);
		expect(documents[0]).toMatchObject({
			youtubeChannelId: "UC_bonsai",
			subscriberCount: 12_000,
			momentum: channel?.momentum,
			viewsPerSubscriber: channel?.viewsPerSubscriber,
		});
	});

	it("does not project a Channel the Entry Bar turned away", async () => {
		const { t, search } = setup([
			aChannel({
				videos: [{ ...shortVideo, viewCount: 1, publishedAt: now - 1 * DAY }],
			}),
		]);

		const result = await t.action(internal.ingestion.ingestChannel, {
			youtubeChannelId: "UC_bonsai",
		});

		expect(result.admitted).toBe(false);
		expect((await search.query({ meetsEntryBar: false })).found).toBe(0);
	});
});

describe("re-projecting a Channel on Refresh", () => {
	it("overwrites the projection with what the fresher crawl found", async () => {
		const seeded = aChannel({ title: "Bonsai Hours" });
		const { t, source, search } = setup([seeded]);
		await t.action(internal.ingestion.ingestChannel, {
			youtubeChannelId: "UC_bonsai",
		});

		// A later crawl finds the Channel renamed: the projection must follow, not keep the
		// stale title beside a fresh one.
		source.set({ ...seeded, title: "Bonsai Hours Reborn" });
		await t.action(internal.ingestion.ingestChannel, {
			youtubeChannelId: "UC_bonsai",
		});

		expect(await searchIds(search, "reborn")).toEqual(["UC_bonsai"]);
		expect((await search.query({})).found).toBe(1);
	});

	it("drops a Channel out of search once it falls below the Entry Bar, keeping its row", async () => {
		const seeded = aChannel();
		const { t, source, search } = setup([seeded]);
		await t.action(internal.ingestion.ingestChannel, {
			youtubeChannelId: "UC_bonsai",
		});
		expect(await searchIds(search, "bonsai")).toEqual(["UC_bonsai"]);

		// The Channel goes quiet: its recent Videos age out of the window and it no longer
		// clears the bar. It stops being searchable, but its row and history survive.
		source.set({
			...seeded,
			videos: [{ ...longVideo, publishedAt: now - 400 * DAY }],
		});
		await t.action(internal.ingestion.ingestChannel, {
			youtubeChannelId: "UC_bonsai",
		});

		expect(await searchIds(search, "bonsai")).toEqual([]);
		// The flagged Channel is still projected, just no longer searchable, and its row
		// remains in Convex so a recovery does not come back amnesiac.
		expect((await search.query({ meetsEntryBar: false })).found).toBe(1);
		expect(
			await t.run((ctx) => ctx.db.query("channels").collect()),
		).toHaveLength(1);
	});
});

describe("rebuilding the projection from Convex", () => {
	it("reconstructs every searchable Channel into an empty engine", async () => {
		const { t } = setup([
			aChannel({ youtubeChannelId: "UC_bonsai", title: "Bonsai Hours" }),
			aChannel({
				youtubeChannelId: "UC_woodwork",
				title: "Woodwork Weekly",
				handle: "@woodwork",
			}),
		]);
		await t.action(internal.ingestion.ingestChannel, {
			youtubeChannelId: "UC_bonsai",
		});
		await t.action(internal.ingestion.ingestChannel, {
			youtubeChannelId: "UC_woodwork",
		});

		// The engine is wiped and stood up empty — a fresh index with nothing in it, exactly
		// the from-scratch case a rebuild has to cover.
		const rebuilt = createFakeSearchIndex();
		setSearchIndex(rebuilt);
		expect((await rebuilt.query({})).found).toBe(0);

		const result = await t.action(
			internal.search.rebuild.rebuildProjection,
			{},
		);

		expect(result.projected).toBe(2);
		expect(await searchIds(rebuilt, "bonsai")).toEqual(["UC_bonsai"]);
		expect(await searchIds(rebuilt, "woodwork")).toEqual(["UC_woodwork"]);
	});

	it("carries a Video's title into the rebuilt projection", async () => {
		const { t } = setup([
			aChannel({
				videos: [
					{ ...longVideo, title: "Repotting a 40-year-old juniper" },
					shortVideo,
				],
			}),
		]);
		await t.action(internal.ingestion.ingestChannel, {
			youtubeChannelId: "UC_bonsai",
		});

		const rebuilt = createFakeSearchIndex();
		setSearchIndex(rebuilt);
		await t.action(internal.search.rebuild.rebuildProjection, {});

		expect(await searchIds(rebuilt, "juniper")).toEqual(["UC_bonsai"]);
	});

	it("rebuilds flagged Channels too, so search and a rebuild agree on what the engine holds", async () => {
		const seeded = aChannel();
		const { t, source } = setup([seeded]);
		await t.action(internal.ingestion.ingestChannel, {
			youtubeChannelId: "UC_bonsai",
		});
		// The Channel falls below the bar: its row stays, flagged.
		source.set({
			...seeded,
			videos: [{ ...longVideo, publishedAt: now - 400 * DAY }],
		});
		await t.action(internal.ingestion.ingestChannel, {
			youtubeChannelId: "UC_bonsai",
		});

		const rebuilt = createFakeSearchIndex();
		setSearchIndex(rebuilt);
		await t.action(internal.search.rebuild.rebuildProjection, {});

		// Not searchable by default, but present in the rebuilt index just as the incremental
		// sync would leave it.
		expect(await searchIds(rebuilt, "bonsai")).toEqual([]);
		expect((await rebuilt.query({ meetsEntryBar: false })).found).toBe(1);
	});
});

describe("a projection failure", () => {
	it("does not fail the crawl: Convex still records the Channel", async () => {
		const { t } = setup([aChannel()]);
		// The engine is down. Convex is the system of record, so the crawl must still land.
		setSearchIndex({
			async upsert() {
				throw new Error("search engine unreachable");
			},
			async query() {
				return { documents: [], found: 0 };
			},
		});
		const warn = vi.spyOn(console, "error").mockImplementation(() => {});

		const result = await t.action(internal.ingestion.ingestChannel, {
			youtubeChannelId: "UC_bonsai",
		});

		expect(result.admitted).toBe(true);
		expect(
			await t.run((ctx) => ctx.db.query("channels").collect()),
		).toHaveLength(1);
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});
});
