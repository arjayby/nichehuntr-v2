import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aChannel, DAY, longVideo } from "../testing/channelFixtures";
import {
	createFakeChannelSource,
	type FakeChannel,
} from "../testing/fakeChannelSource";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import crons from "./crons";
import { setChannelSource } from "./discovery/channelSource";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

const setup = (seed: FakeChannel[]) => {
	const source = createFakeChannelSource(seed);
	setChannelSource(source);
	const t = convexTest(schema, modules);
	return {
		t,
		source,
		/** Runs the crawls a Refresh scheduled, and waits for them to land. */
		settle: () => t.finishAllScheduledFunctions(vi.runAllTimers),

		/** Puts a Channel in the index, as an earlier crawl would have. */
		async index(youtubeChannelId: string) {
			await t.action(internal.ingestion.ingestChannel, { youtubeChannelId });
		},

		/** Ages a Channel, so that it is due a Refresh again. */
		async age(youtubeChannelId: string, by: number) {
			await t.run(async (ctx) => {
				const channel = await ctx.db
					.query("channels")
					.withIndex("by_youtube_channel_id", (q) =>
						q.eq("youtubeChannelId", youtubeChannelId),
					)
					.unique();
				await ctx.db.patch(channel?._id as Id<"channels">, {
					lastRefreshedAt: Date.now() - by,
					lastRefreshAttemptedAt: Date.now() - by,
				});
			});
		},

		channels: () => t.run((ctx) => ctx.db.query("channels").collect()),
		snapshots: () => t.run((ctx) => ctx.db.query("channelSnapshots").collect()),
	};
};

// A scheduled crawl runs on a timer; the tests drive that timer themselves rather
// than waiting on wall-clock.
beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	setChannelSource(null);
});

describe("a Refresh", () => {
	it("appends a Channel Snapshot of the Channel's stats", async () => {
		const { index, channels, snapshots } = setup([aChannel()]);

		await index("UC_bonsai");

		const [channel] = await channels();
		const taken = await snapshots();
		expect(taken).toHaveLength(1);
		expect(taken[0]).toMatchObject({
			channelId: channel?._id,
			subscriberCount: 12_000,
			totalViewCount: 4_000_000,
			videoCount: 120,
		});
		expect(taken[0]?.takenAt).toBe(channel?.lastRefreshedAt);
	});

	it("appends rather than overwrites, so history accrues Refresh by Refresh", async () => {
		const seeded = aChannel();
		const { source, index, snapshots } = setup([seeded]);

		for (const subscriberCount of [12_000, 15_000, 19_000]) {
			source.set({ ...seeded, subscriberCount });
			await index("UC_bonsai");
		}

		// Three crawls, three measurements — a Snapshot overwritten is a measurement
		// destroyed, and it cannot be taken again.
		expect((await snapshots()).map((taken) => taken.subscriberCount)).toEqual([
			12_000, 15_000, 19_000,
		]);
	});

	it("updates the Channel's current stats and recomputes its Signals", async () => {
		const seeded = aChannel();
		const { t, source, index, age, channels, settle } = setup([seeded]);
		await index("UC_bonsai");
		await age("UC_bonsai", 30 * DAY);

		source.set({
			...seeded,
			subscriberCount: 24_000,
			totalViewCount: 8_000_000,
			videos: [{ ...longVideo, viewCount: 400_000 }],
		});
		await t.action(internal.refresh.refreshDueChannels, {});
		await settle();

		const indexed = await channels();
		expect(indexed).toHaveLength(1);
		expect(indexed[0]).toMatchObject({
			subscriberCount: 24_000,
			totalViewCount: 8_000_000,
			medianViewsPerVideo: 400_000,
			viewsPerSubscriber: 8_000_000 / 24_000,
		});
	});

	it("records the Channel's Freshness, so its stats can be trusted or doubted", async () => {
		const { t, index, age, channels, settle } = setup([aChannel()]);
		await index("UC_bonsai");
		await age("UC_bonsai", 30 * DAY);

		await t.action(internal.refresh.refreshDueChannels, {});
		await settle();

		const [refreshed] = await channels();
		expect(refreshed?.lastRefreshedAt).toBe(Date.now());
	});

	it("is scheduled, so history accrues without anyone asking for it", () => {
		// A Refresh that only ran on demand would record history only for the Channels
		// somebody happened to ask about — and the days it did not run are lost.
		expect(crons.crons["refresh due channels"]).toMatchObject({
			schedule: { type: "interval", hours: 1 },
		});
	});
});

describe("refreshDueChannels", () => {
	it("Refreshes the Channels we have not looked at in too long", async () => {
		const seeded = aChannel();
		const { t, source, index, age, channels, snapshots, settle } = setup([
			seeded,
		]);
		await index("UC_bonsai");
		await age("UC_bonsai", 30 * DAY);

		// The Channel kept growing while we were not looking.
		source.set({ ...seeded, subscriberCount: 40_000 });
		await t.action(internal.refresh.refreshDueChannels, {});
		await settle();

		const [refreshed] = await channels();
		expect(refreshed?.subscriberCount).toBe(40_000);
		expect((await snapshots()).map((taken) => taken.subscriberCount)).toEqual([
			12_000, 40_000,
		]);
	});

	it("leaves a Channel we have just read alone, so no Crawl Budget is wasted", async () => {
		const seeded = aChannel();
		const { t, source, index, channels, snapshots, settle } = setup([seeded]);
		await index("UC_bonsai");

		source.set({ ...seeded, subscriberCount: 40_000 });
		await t.action(internal.refresh.refreshDueChannels, {});
		await settle();

		const [channel] = await channels();
		expect(channel?.subscriberCount).toBe(12_000);
		expect(await snapshots()).toHaveLength(1);
	});

	it("spends its budget on the Channels we have looked at least recently", async () => {
		const seeded = ["UC_stalest", "UC_stale", "UC_recent"].map(
			(youtubeChannelId) => aChannel({ youtubeChannelId }),
		);
		const { t, index, age, channels, settle } = setup(seeded);
		for (const channel of seeded) {
			await index(channel.youtubeChannelId);
		}
		await age("UC_stalest", 90 * DAY);
		await age("UC_stale", 30 * DAY);
		await age("UC_recent", 10 * DAY);

		// A budget of two: the two Channels we have looked at least recently.
		await t.action(internal.refresh.refreshDueChannels, { limit: 2 });
		await settle();

		const freshness = new Map(
			(await channels()).map((channel) => [
				channel.youtubeChannelId,
				channel.lastRefreshedAt,
			]),
		);
		expect(freshness.get("UC_stalest")).toBe(Date.now());
		expect(freshness.get("UC_stale")).toBe(Date.now());
		expect(freshness.get("UC_recent")).toBeLessThan(Date.now() - DAY);
	});

	it("does not crawl a Channel whose Refresh is already in flight", async () => {
		const seeded = aChannel();
		const { t, index, age, snapshots, settle } = setup([seeded]);
		await index("UC_bonsai");
		await age("UC_bonsai", 30 * DAY);

		// The scheduler ticks again while the first run's crawls are still draining. A
		// Channel already claimed must not be paid for twice.
		await t.action(internal.refresh.refreshDueChannels, {});
		await t.action(internal.refresh.refreshDueChannels, {});
		await settle();

		expect(await snapshots()).toHaveLength(2);
	});

	it("does not let a Channel that has gone from YouTube hold the budget open", async () => {
		const seeded = [
			aChannel({ youtubeChannelId: "UC_gone" }),
			aChannel({ youtubeChannelId: "UC_alive" }),
		];
		const { t, source, index, age, channels, settle } = setup(seeded);
		for (const channel of seeded) {
			await index(channel.youtubeChannelId);
		}
		// The dead Channel is the stalest, so it is first in line for every crawl.
		await age("UC_gone", 90 * DAY);
		await age("UC_alive", 30 * DAY);
		source.remove("UC_gone");

		// A budget of one per run: if the dead Channel kept its place at the head of the
		// queue, it would starve every live Channel behind it, every run, forever.
		await t.action(internal.refresh.refreshDueChannels, { limit: 1 });
		await settle();
		await t.action(internal.refresh.refreshDueChannels, { limit: 1 });
		await settle();

		const freshness = new Map(
			(await channels()).map((channel) => [
				channel.youtubeChannelId,
				channel.lastRefreshedAt,
			]),
		);
		expect(freshness.get("UC_alive")).toBe(Date.now());
		// And we tell the truth about the one we could not read: its Freshness is old,
		// because we did not manage to look at it.
		expect(freshness.get("UC_gone")).toBeLessThan(Date.now() - 30 * DAY);
	});

	it("Refreshes the rest of the batch when one Channel's crawl fails", async () => {
		const seeded = [
			aChannel({ youtubeChannelId: "UC_gone" }),
			aChannel({ youtubeChannelId: "UC_alive" }),
		];
		const { t, source, index, age, channels, settle } = setup(seeded);
		for (const channel of seeded) {
			await index(channel.youtubeChannelId);
			await age(channel.youtubeChannelId, 30 * DAY);
		}

		// The Channel was deleted on YouTube between crawls.
		source.remove("UC_gone");
		source.set({ ...(seeded[1] as FakeChannel), subscriberCount: 40_000 });
		await t.action(internal.refresh.refreshDueChannels, {});
		await settle();

		const alive = (await channels()).find(
			(channel) => channel.youtubeChannelId === "UC_alive",
		);
		expect(alive?.subscriberCount).toBe(40_000);
	});

	it("ages a Channel out of the index once it goes quiet", async () => {
		// The Entry Bar garbage-collects, but only a crawl can notice: this is the whole
		// chain the cron drives — Refresh claims the Channel, crawls it, and the crawl
		// judges it against the bar it can no longer clear.
		const seeded = aChannel();
		const { t, source, index, age, channels, settle } = setup([seeded]);
		await index("UC_bonsai");
		expect((await channels())[0]?.meetsEntryBar).toBe(true);
		await age("UC_bonsai", 30 * DAY);

		// It stopped uploading: its last Videos have aged out of the recent-views window,
		// and neither its subscribers nor its back-catalogue can hold its place.
		source.set({
			...seeded,
			subscriberCount: 200_000,
			videos: [{ ...longVideo, publishedAt: Date.now() - 400 * DAY }],
		});
		await t.action(internal.refresh.refreshDueChannels, {});
		await settle();

		const [quiet] = await channels();
		expect(quiet?.meetsEntryBar).toBe(false);
	});

	it("keeps Refreshing an aged-out Channel, so it can earn its way back in", async () => {
		// Refresh queues on Freshness, not on Entry Bar status. A Channel dropped from the
		// index that stopped being crawled could never be seen to recover — it would be
		// evicted permanently by a rule that is meant to be reversible.
		const seeded = aChannel();
		const { t, source, index, age, channels, settle } = setup([seeded]);
		await index("UC_bonsai");
		const [first] = await channels();

		await age("UC_bonsai", 30 * DAY);
		source.set({
			...seeded,
			videos: [{ ...longVideo, publishedAt: Date.now() - 400 * DAY }],
		});
		await t.action(internal.refresh.refreshDueChannels, {});
		await settle();
		expect((await channels())[0]?.meetsEntryBar).toBe(false);

		// It starts uploading again, and the next scheduled Refresh finds it.
		await age("UC_bonsai", 30 * DAY);
		source.set(seeded);
		await t.action(internal.refresh.refreshDueChannels, {});
		await settle();

		const readmitted = await channels();
		expect(readmitted).toHaveLength(1);
		expect(readmitted[0]?.meetsEntryBar).toBe(true);
		// Under its original id: the Snapshot history it accrued survived the dip.
		expect(readmitted[0]?._id).toBe(first?._id);
	});

	it("Refreshes a Channel indexed before we tracked Refresh attempts at all", async () => {
		const seeded = aChannel();
		const { t, source, index, channels, settle } = setup([seeded]);
		await index("UC_bonsai");
		// A Channel from before this field existed has never recorded an attempt, and is
		// the most overdue thing in the index — not the least.
		await t.run(async (ctx) => {
			const [channel] = await ctx.db.query("channels").collect();
			await ctx.db.patch(channel?._id as Id<"channels">, {
				lastRefreshAttemptedAt: undefined,
			});
		});

		source.set({ ...seeded, subscriberCount: 40_000 });
		await t.action(internal.refresh.refreshDueChannels, {});
		await settle();

		const [refreshed] = await channels();
		expect(refreshed?.subscriberCount).toBe(40_000);
	});
});
