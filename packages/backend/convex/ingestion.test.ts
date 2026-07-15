import { convexTest } from "convex-test";
import { afterEach, describe, expect, it } from "vitest";
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
import type { Doc } from "./_generated/dataModel";
import { type SourceVideo, setChannelSource } from "./discovery/channelSource";
import { MINIMUM_RECENT_VIEWS } from "./discovery/entryBar";
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

describe("ingestChannel", () => {
	it("stores the Channel and its recent Videos", async () => {
		const { t } = setup([aChannel()]);

		await t.action(internal.ingestion.ingestChannel, {
			youtubeChannelId: "UC_bonsai",
		});

		const channels = await t.run((ctx) => ctx.db.query("channels").collect());
		expect(channels).toHaveLength(1);
		expect(channels[0]).toMatchObject({
			youtubeChannelId: "UC_bonsai",
			title: "Bonsai Hours",
			handle: "@bonsaihours",
			subscriberCount: 12_000,
			totalViewCount: 4_000_000,
			videoCount: 120,
		});

		const videos = await t.run((ctx) => ctx.db.query("videos").collect());
		expect(videos.map((video) => video.youtubeVideoId).sort()).toEqual([
			"vid_long",
			"vid_short",
		]);
		expect(videos.every((video) => video.channelId === channels[0]?._id)).toBe(
			true,
		);
	});

	it("derives each Video's Form, and stores no Form on the Channel", async () => {
		const { t } = setup([aChannel()]);

		await t.action(internal.ingestion.ingestChannel, {
			youtubeChannelId: "UC_bonsai",
		});

		const videos = await t.run((ctx) => ctx.db.query("videos").collect());
		const formById = new Map(
			videos.map((video) => [video.youtubeVideoId, video.form]),
		);
		expect(formById.get("vid_short")).toBe("short");
		expect(formById.get("vid_long")).toBe("longform");

		const [channel] = await t.run((ctx) => ctx.db.query("channels").collect());
		expect(channel).toBeDefined();
		expect(Object.keys(channel as Doc<"channels">)).not.toContain("form");
	});

	it("splits Short from Long-form at the three-minute mark", async () => {
		const { t } = setup([
			aChannel({
				videos: [
					{ ...shortVideo, youtubeVideoId: "vid_180", durationSeconds: 180 },
					{ ...longVideo, youtubeVideoId: "vid_181", durationSeconds: 181 },
				],
			}),
		]);

		await t.action(internal.ingestion.ingestChannel, {
			youtubeChannelId: "UC_bonsai",
		});

		const videos = await t.run((ctx) => ctx.db.query("videos").collect());
		const formById = new Map(
			videos.map((video) => [video.youtubeVideoId, video.form]),
		);
		expect(formById.get("vid_180")).toBe("short");
		expect(formById.get("vid_181")).toBe("longform");
	});

	it("records when the Channel was last read, so Freshness is knowable", async () => {
		const { t } = setup([aChannel()]);
		const before = Date.now();

		await t.action(internal.ingestion.ingestChannel, {
			youtubeChannelId: "UC_bonsai",
		});

		const [channel] = await t.run((ctx) => ctx.db.query("channels").collect());
		expect(channel?.lastRefreshedAt).toBeGreaterThanOrEqual(before);
	});

	it("updates the Channel and its Videos on re-ingest rather than duplicating them", async () => {
		const seeded = aChannel();
		const { t, source } = setup([seeded]);
		await t.action(internal.ingestion.ingestChannel, {
			youtubeChannelId: "UC_bonsai",
		});
		const [first] = await t.run((ctx) => ctx.db.query("channels").collect());

		source.set({
			...seeded,
			subscriberCount: 15_000,
			videoCount: 3,
			videos: [
				// The Short kept accruing views since the last crawl.
				{ ...shortVideo, viewCount: 1_200_000 },
				longVideo,
				{
					youtubeVideoId: "vid_new",
					title: "Wiring a windswept pine",
					publishedAt: now,
					viewCount: 20_000,
					durationSeconds: 9 * 60,
				},
			],
		});
		await t.action(internal.ingestion.ingestChannel, {
			youtubeChannelId: "UC_bonsai",
		});

		const channels = await t.run((ctx) => ctx.db.query("channels").collect());
		expect(channels).toHaveLength(1);
		expect(channels[0]?._id).toBe(first?._id);
		expect(channels[0]?.subscriberCount).toBe(15_000);

		const videos = await t.run((ctx) => ctx.db.query("videos").collect());
		expect(videos).toHaveLength(3);
		const short = videos.find((video) => video.youtubeVideoId === "vid_short");
		expect(short?.viewCount).toBe(1_200_000);
	});

	it("ingests only the most recent Videos, up to the crawl's limit", async () => {
		const seeded = aChannel({
			videos: Array.from({ length: 5 }, (_, index) => ({
				youtubeVideoId: `vid_${index}`,
				title: `Episode ${index}`,
				publishedAt: now - index * DAY,
				viewCount: 50_000,
				durationSeconds: 300,
			})),
		});
		const { t } = setup([seeded]);

		await t.action(internal.ingestion.ingestChannel, {
			youtubeChannelId: "UC_bonsai",
			videoLimit: 2,
		});

		const videos = await t.run((ctx) => ctx.db.query("videos").collect());
		expect(videos.map((video) => video.youtubeVideoId).sort()).toEqual([
			"vid_0",
			"vid_1",
		]);
	});

	it("computes the Channel's Signals at ingest and stores them on the Channel", async () => {
		const { t } = setup([aChannel()]);

		await t.action(internal.ingestion.ingestChannel, {
			youtubeChannelId: "UC_bonsai",
		});

		const [channel] = await t.run((ctx) => ctx.db.query("channels").collect());
		// The crawl returned two recent Videos: a Short at 800k and a Long-form at 90k.
		expect(channel).toMatchObject({
			// 4m lifetime views over 12k subscribers.
			viewsPerSubscriber: 4_000_000 / 12_000,
			medianViewsPerVideo: 445_000,
			shortsUploadShare: 0.5,
			uploadCadencePerWeek: 2 / (30 / 7),
		});
		// Its one Short earns 90% of its views off half its uploads: a Channel whose
		// Shorts genuinely work, which the two shares keep visible.
		expect(channel?.shortsViewShare).toBeCloseTo(800_000 / 890_000);
		// Recent Videos averaging 445k against a lifetime average Video of ~33k: this
		// Channel is heating up, and Momentum says so off a single crawl.
		expect(channel?.momentum).toBeCloseTo(445_000 / (4_000_000 / 120));
		expect(channel?.momentum).toBeGreaterThan(13);
		expect(channel?.outlierRatio).toBeCloseTo(800_000 / 445_000);
		expect(channel?.channelAgeDays).toBeGreaterThanOrEqual(400);
	});

	it("recomputes the Channel's Signals on re-ingest, against the fresher crawl", async () => {
		const seeded = aChannel();
		const { t, source } = setup([seeded]);
		await t.action(internal.ingestion.ingestChannel, {
			youtubeChannelId: "UC_bonsai",
		});

		source.set({
			...seeded,
			subscriberCount: 24_000,
			totalViewCount: 8_000_000,
			videos: [longVideo, { ...shortVideo, viewCount: 1_600_000 }],
		});
		await t.action(internal.ingestion.ingestChannel, {
			youtubeChannelId: "UC_bonsai",
		});

		const [channel] = await t.run((ctx) => ctx.db.query("channels").collect());
		expect(channel?.medianViewsPerVideo).toBe(845_000);
		expect(channel?.viewsPerSubscriber).toBe(8_000_000 / 24_000);
	});

	it("leaves a Signal it cannot compute absent, rather than storing a zero", async () => {
		// A Channel with nothing inside the recent window has no Momentum, and a stored zero
		// would sort it below every Channel that is merely cooling off.
		//
		// It has to be crawled into the index before it goes quiet, because the Entry Bar
		// would never have admitted it in this state: a Channel whose Signals cannot be
		// computed at all is, by definition, one that published nothing recent — which is
		// exactly what the bar turns away. The only Channel in the index with absent Signals
		// is one that earned its place and then fell silent.
		const seeded = aChannel({ subscriberCount: 0 });
		const { t, source } = setup([seeded]);
		await t.action(internal.ingestion.ingestChannel, {
			youtubeChannelId: "UC_bonsai",
		});

		source.set({
			...seeded,
			videos: [{ ...longVideo, publishedAt: now - 120 * DAY }],
		});
		await t.action(internal.ingestion.ingestChannel, {
			youtubeChannelId: "UC_bonsai",
		});

		const [channel] = await t.run((ctx) => ctx.db.query("channels").collect());
		expect(channel).toBeDefined();
		expect(channel).not.toHaveProperty("momentum");
		// Zero subscribers is not a divide-by-zero, and not a Views per Subscriber of 0.
		expect(channel).not.toHaveProperty("viewsPerSubscriber");
		// Nor does a Channel with nothing recent have a Form Share or an Outlier Ratio:
		// there is no recent window to measure, and an absent Signal says so honestly.
		expect(channel).not.toHaveProperty("shortsUploadShare");
		expect(channel).not.toHaveProperty("shortsViewShare");
		expect(channel).not.toHaveProperty("outlierRatio");
		// But it really did publish nothing this month, and that is a fact, not a gap.
		expect(channel?.uploadCadencePerWeek).toBe(0);
	});

	it("stores no composite score, and no Form verdict, on the Channel", async () => {
		const { t } = setup([aChannel()]);

		await t.action(internal.ingestion.ingestChannel, {
			youtubeChannelId: "UC_bonsai",
		});

		const [channel] = await t.run((ctx) => ctx.db.query("channels").collect());
		const fields = Object.keys(channel as Doc<"channels">);
		expect(fields).not.toContain("opportunityScore");
		expect(fields).not.toContain("score");
		// Form Shares are two separate ratios. A Channel is never labelled.
		expect(fields).toContain("shortsUploadShare");
		expect(fields).toContain("shortsViewShare");
		expect(fields).not.toContain("form");
	});

	it("stores nothing when the source has never heard of the Channel", async () => {
		const { t } = setup([aChannel()]);

		await expect(
			t.action(internal.ingestion.ingestChannel, {
				youtubeChannelId: "UC_ghost",
			}),
		).rejects.toThrow(/UC_ghost/);

		const channels = await t.run((ctx) => ctx.db.query("channels").collect());
		expect(channels).toHaveLength(0);
	});
});

/**
 * The Entry Bar is not a Signal and has no seam of its own — it is exercised here,
 * through ingestion, by feeding fixture Videos in via the ChannelSource fake.
 */
describe("the Entry Bar", () => {
	/** A Video old enough to have left the recent-views window entirely. */
	const dormantVideo: SourceVideo = {
		youtubeVideoId: "vid_glory_days",
		title: "The one that did numbers, once",
		publishedAt: now - 400 * DAY,
		viewCount: 12_000_000,
		durationSeconds: 11 * 60,
	};

	const channelsIn = (t: ReturnType<typeof setup>["t"]) =>
		t.run((ctx) => ctx.db.query("channels").collect());

	it("admits a Channel on recent views alone, however few subscribers it has", async () => {
		const { t } = setup([
			aChannel({
				subscriberCount: 300,
				totalViewCount: 800_000,
				videos: [{ ...shortVideo, viewCount: 800_000 }],
			}),
		]);

		const result = await t.action(internal.ingestion.ingestChannel, {
			youtubeChannelId: "UC_bonsai",
		});

		expect(result.admitted).toBe(true);
		expect(await channelsIn(t)).toHaveLength(1);
	});

	it("rejects a dormant Channel, however many subscribers it has", async () => {
		const { t } = setup([
			aChannel({
				subscriberCount: 50_000,
				totalViewCount: 12_000_000,
				videos: [dormantVideo],
			}),
		]);

		const result = await t.action(internal.ingestion.ingestChannel, {
			youtubeChannelId: "UC_bonsai",
		});

		expect(result.admitted).toBe(false);
		expect(await channelsIn(t)).toHaveLength(0);
		expect(await t.run((ctx) => ctx.db.query("videos").collect())).toHaveLength(
			0,
		);
	});

	it("rejects a Channel whose recent Videos fall short of the bar", async () => {
		const { t } = setup([
			aChannel({
				videos: [{ ...shortVideo, viewCount: MINIMUM_RECENT_VIEWS - 1 }],
			}),
		]);

		const result = await t.action(internal.ingestion.ingestChannel, {
			youtubeChannelId: "UC_bonsai",
		});

		expect(result.admitted).toBe(false);
		expect(await channelsIn(t)).toHaveLength(0);
	});

	it("counts a Channel's recent Videos together against the bar", async () => {
		const half = Math.ceil(MINIMUM_RECENT_VIEWS / 2);
		const { t } = setup([
			aChannel({
				videos: [
					{ ...shortVideo, viewCount: half },
					{ ...longVideo, viewCount: half },
				],
			}),
		]);

		const result = await t.action(internal.ingestion.ingestChannel, {
			youtubeChannelId: "UC_bonsai",
		});

		expect(result.admitted).toBe(true);
	});

	it("ages an indexed Channel out of the index once its uploads go quiet", async () => {
		const seeded = aChannel();
		const { t, source } = setup([seeded]);
		await t.action(internal.ingestion.ingestChannel, {
			youtubeChannelId: "UC_bonsai",
		});
		expect((await channelsIn(t))[0]?.meetsEntryBar).toBe(true);

		// The Channel stopped uploading: its last Videos have aged out of the window,
		// and its subscribers and back-catalogue views cannot save it.
		source.set({
			...seeded,
			subscriberCount: 200_000,
			videos: [dormantVideo],
		});
		const result = await t.action(internal.ingestion.ingestChannel, {
			youtubeChannelId: "UC_bonsai",
		});

		expect(result.admitted).toBe(false);
		const [channel] = await channelsIn(t);
		expect(channel?.meetsEntryBar).toBe(false);
	});

	it("keeps an aged-out Channel's history, so a recovery is not amnesiac", async () => {
		const seeded = aChannel();
		const { t, source } = setup([seeded]);
		await t.action(internal.ingestion.ingestChannel, {
			youtubeChannelId: "UC_bonsai",
		});
		const [first] = await channelsIn(t);

		source.set({ ...seeded, videos: [dormantVideo] });
		await t.action(internal.ingestion.ingestChannel, {
			youtubeChannelId: "UC_bonsai",
		});

		// The row survives the dip, under its original id: a Channel that comes back must
		// still own the Snapshot history we could never backfill for it.
		const channels = await channelsIn(t);
		expect(channels).toHaveLength(1);
		expect(channels[0]?._id).toBe(first?._id);
		expect(
			await t.run((ctx) => ctx.db.query("videos").collect()),
		).not.toHaveLength(0);
	});

	it("re-admits an aged-out Channel that starts clearing the bar again", async () => {
		const seeded = aChannel();
		const { t, source } = setup([seeded]);
		await t.action(internal.ingestion.ingestChannel, {
			youtubeChannelId: "UC_bonsai",
		});
		const [first] = await channelsIn(t);

		// It goes quiet and drops out of the index...
		source.set({ ...seeded, videos: [dormantVideo] });
		await t.action(internal.ingestion.ingestChannel, {
			youtubeChannelId: "UC_bonsai",
		});
		expect((await channelsIn(t))[0]?.meetsEntryBar).toBe(false);

		// ...then uploads something that works, and is back in.
		source.set(seeded);
		const result = await t.action(internal.ingestion.ingestChannel, {
			youtubeChannelId: "UC_bonsai",
		});

		expect(result.admitted).toBe(true);
		const channels = await channelsIn(t);
		expect(channels).toHaveLength(1);
		expect(channels[0]?.meetsEntryBar).toBe(true);
		expect(channels[0]?._id).toBe(first?._id);
	});

	it("keeps an indexed Channel that is still clearing the bar", async () => {
		const seeded = aChannel();
		const { t, source } = setup([seeded]);
		await t.action(internal.ingestion.ingestChannel, {
			youtubeChannelId: "UC_bonsai",
		});
		const [first] = await channelsIn(t);

		source.set({ ...seeded, subscriberCount: 15_000 });
		await t.action(internal.ingestion.ingestChannel, {
			youtubeChannelId: "UC_bonsai",
		});

		const channels = await channelsIn(t);
		expect(channels).toHaveLength(1);
		expect(channels[0]?._id).toBe(first?._id);
		expect(channels[0]?.subscriberCount).toBe(15_000);
		expect(channels[0]?.meetsEntryBar).toBe(true);
	});
});
