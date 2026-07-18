/**
 * The Channel detail read: everything the case for (or against) cloning a Channel is made of,
 * for one Channel, straight from Convex — its Signals, its recent Videos, and which of those
 * Videos broke out against the Channel's own median.
 *
 * A Convex query, not a search: search reaches an external engine over HTTP and cannot be
 * reactive (ADR-0001), but a Channel and its Videos are flat documents this system of record
 * holds, so the detail is a plain reactive read. These tests seed Convex through the ingest
 * path — so a fixture means what a real crawl would have written — and read it back.
 */
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it } from "vitest";
import {
	aChannel,
	DAY,
	longVideo,
	NOW,
	shortVideo,
} from "../testing/channelFixtures";
import { createFakeChannelSource } from "../testing/fakeChannelSource";
import { createFakeSearchIndex } from "../testing/fakeSearchIndex";
import { api, internal } from "./_generated/api";
import type { SourceVideo } from "./discovery/channelSource";
import { setChannelSource } from "./discovery/channelSource";
import { OUTLIER_THRESHOLD } from "./discovery/outliers";
import schema from "./schema";
import { setSearchIndex } from "./search/searchIndex";

const modules = import.meta.glob("./**/*.*s");

/** Stands up a Convex test with the given Channel crawled into the index. */
const setup = async (channel = aChannel()) => {
	setChannelSource(createFakeChannelSource([channel]));
	setSearchIndex(createFakeSearchIndex());
	const t = convexTest(schema, modules);
	await t.action(internal.ingestion.ingestChannel, {
		youtubeChannelId: channel.youtubeChannelId,
	});
	return t;
};

afterEach(() => {
	setChannelSource(null);
	setSearchIndex(null);
});

describe("reading one Channel in full", () => {
	it("returns nothing for a Channel the index has never seen", async () => {
		const t = await setup();

		const detail = await t.query(api.channels.detail.getChannelDetail, {
			youtubeChannelId: "UC_unknown",
		});

		expect(detail).toBeNull();
	});

	it("carries the Channel's identity and a way back to it on YouTube", async () => {
		const t = await setup();

		const detail = await t.query(api.channels.detail.getChannelDetail, {
			youtubeChannelId: "UC_bonsai",
		});

		expect(detail?.youtubeChannelId).toBe("UC_bonsai");
		expect(detail?.title).toBe("Bonsai Hours");
		expect(detail?.description).toBe("Slow television for small trees.");
	});

	it("shows how old the numbers are — a stat here is never shown without its Freshness", async () => {
		const t = await setup();

		const detail = await t.query(api.channels.detail.getChannelDetail, {
			youtubeChannelId: "UC_bonsai",
		});

		expect(typeof detail?.lastRefreshedAt).toBe("number");
	});

	it("brings all the Channel's Signals together on the one Channel", async () => {
		const t = await setup();

		const detail = await t.query(api.channels.detail.getChannelDetail, {
			youtubeChannelId: "UC_bonsai",
		});

		// The default fixture is a Channel heating up: a lifetime average Video of ~33k and two
		// recent Videos far above it. Every Signal the Channel is sorted by is present here.
		expect(detail?.momentum).toBeGreaterThan(1);
		expect(detail?.viewsPerSubscriber).toBeCloseTo(4_000_000 / 12_000);
		expect(detail?.medianViewsPerVideo).toBeDefined();
		expect(detail?.outlierRatio).toBeDefined();
		expect(detail?.uploadCadencePerWeek).toBeGreaterThan(0);
		expect(detail?.channelAgeDays).toBeGreaterThan(0);
		expect(detail?.shortsUploadShare).toBeDefined();
		expect(detail?.shortsViewShare).toBeDefined();
	});
});

describe("the Channel's recent Videos", () => {
	it("lists each recent Video with the view count, publish date and Form the case rests on", async () => {
		const t = await setup();

		const detail = await t.query(api.channels.detail.getChannelDetail, {
			youtubeChannelId: "UC_bonsai",
		});

		const byId = new Map(detail?.videos.map((v) => [v.youtubeVideoId, v]));
		expect(byId.get("vid_long")).toMatchObject({
			viewCount: longVideo.viewCount,
			publishedAt: longVideo.publishedAt,
			form: "longform",
		});
		expect(byId.get("vid_short")).toMatchObject({
			viewCount: shortVideo.viewCount,
			publishedAt: shortVideo.publishedAt,
			form: "short",
		});
	});

	it("lists the most recent Video first", async () => {
		const t = await setup();

		const detail = await t.query(api.channels.detail.getChannelDetail, {
			youtubeChannelId: "UC_bonsai",
		});

		// shortVideo was published a day ago, longVideo three days ago.
		expect(detail?.videos.map((v) => v.youtubeVideoId)).toEqual([
			"vid_short",
			"vid_long",
		]);
	});

	it("marks the Videos that broke out against this Channel's own median", async () => {
		// A Channel whose typical Video does 10k, with one recent Video that did 50k — the
		// specific idea that just printed. The median needs a spread of Videos to sit below the
		// breakout; two Videos can never put one at 3× the other's midpoint.
		const video = (
			id: string,
			viewCount: number,
			daysAgo: number,
		): SourceVideo => ({
			youtubeVideoId: id,
			title: id,
			publishedAt: NOW - daysAgo * DAY,
			viewCount,
			durationSeconds: 8 * 60,
		});
		const t = await setup(
			aChannel({
				videos: [
					video("outlier", 50_000, 1),
					video("typical_a", 10_000, 2),
					video("typical_b", 10_000, 3),
					video("typical_c", 9_000, 4),
				],
			}),
		);

		const detail = await t.query(api.channels.detail.getChannelDetail, {
			youtubeChannelId: "UC_bonsai",
		});

		const median = detail?.medianViewsPerVideo ?? 0;
		for (const v of detail?.videos ?? []) {
			// Each Video's mark is exactly the comparison the acceptance criterion names: its own
			// views against the Channel's median, flagged when it trebles it.
			expect(v.isOutlier).toBe(v.viewCount >= median * OUTLIER_THRESHOLD);
		}
		// The 50k Video against a ~10k median is a 5× breakout, and the only one marked.
		expect(
			detail?.videos.filter((v) => v.isOutlier).map((v) => v.youtubeVideoId),
		).toEqual(["outlier"]);
	});
});
