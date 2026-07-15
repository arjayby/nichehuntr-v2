import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	aChannel,
	DAY,
	flatChannel,
	longVideo,
} from "../testing/channelFixtures";
import {
	createFakeChannelSource,
	type FakeChannel,
} from "../testing/fakeChannelSource";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { DAILY_CRAWL_BUDGET, recordCrawlSpend } from "./crawl/budget";
import crons from "./crons";
import { setChannelSource } from "./discovery/channelSource";
import { CRAWL_BUDGET_PER_RUN, REFRESH_RUNS_PER_DAY } from "./refresh";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

const HOUR = 60 * 60 * 1000;

/** Leaves the day's Crawl Budget spent, so the next run cannot afford anything. */
const spendTheDay = (t: ReturnType<typeof convexTest>) =>
	t.run((ctx) =>
		recordCrawlSpend(ctx, { now: Date.now(), crawls: DAILY_CRAWL_BUDGET }),
	);

/** How many Snapshots we hold of one Channel: how often it was actually Refreshed. */
const refreshCount = (
	snapshots: { channelId: Id<"channels"> }[],
	channelId: Id<"channels"> | undefined,
) => snapshots.filter((snapshot) => snapshot.channelId === channelId).length;

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

		/**
		 * Ages a Channel, so that it is due a Refresh again. Its deadline moves back with
		 * it, so a Channel aged further is one that came due earlier — the order the crawl
		 * queue is worked in.
		 */
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
					refreshDueAt: (channel?.refreshDueAt ?? Date.now()) - by,
				});
			});
		},

		/** Puts the Channel in users' saved Niches, so someone is waiting on it. */
		async demand(youtubeChannelId: string, savedNiches: number) {
			await t.run(async (ctx) => {
				const channel = await ctx.db
					.query("channels")
					.withIndex("by_youtube_channel_id", (q) =>
						q.eq("youtubeChannelId", youtubeChannelId),
					)
					.unique();
				await ctx.db.patch(channel?._id as Id<"channels">, {
					demand: savedNiches,
				});
			});
		},

		channels: () => t.run((ctx) => ctx.db.query("channels").collect()),
		snapshots: () => t.run((ctx) => ctx.db.query("channelSnapshots").collect()),
		budget: () => t.query(internal.crawl.budget.consumption, {}),
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

	it("Refreshes a Channel indexed before Refresh had a priority at all", async () => {
		const seeded = aChannel();
		const { t, source, index, channels, settle } = setup([seeded]);
		await index("UC_bonsai");
		// A Channel from before these fields existed was never promised a Refresh, and is
		// the most overdue thing in the index — not the least.
		await t.run(async (ctx) => {
			const [channel] = await ctx.db.query("channels").collect();
			await ctx.db.patch(channel?._id as Id<"channels">, {
				lastRefreshAttemptedAt: undefined,
				refreshDueAt: undefined,
				refreshPriority: undefined,
			});
		});

		source.set({ ...seeded, subscriberCount: 40_000 });
		await t.action(internal.refresh.refreshDueChannels, {});
		await settle();

		const [refreshed] = await channels();
		expect(refreshed?.subscriberCount).toBe(40_000);
	});
});

describe("Refresh priority", () => {
	it("Refreshes a high-Momentum Channel more often than a flat one", async () => {
		// Two Channels crawled side by side for a fortnight. One is doing far better than
		// its own lifetime average; the other is doing exactly it. Uniform Refresh would
		// read them the same number of times, and half those crawls would buy nothing.
		const { t, index, channels, snapshots, settle } = setup([
			aChannel({ youtubeChannelId: "UC_hot" }),
			flatChannel({ youtubeChannelId: "UC_flat" }),
		]);
		await index("UC_hot");
		await index("UC_flat");

		for (let tick = 0; tick < 14 * 4; tick++) {
			vi.advanceTimersByTime(6 * HOUR);
			await t.action(internal.refresh.refreshDueChannels, {});
			await settle();
		}

		const indexed = await channels();
		const idOf = (youtubeChannelId: string) =>
			indexed.find((channel) => channel.youtubeChannelId === youtubeChannelId)
				?._id;
		const taken = await snapshots();

		expect(refreshCount(taken, idOf("UC_hot"))).toBeGreaterThan(
			refreshCount(taken, idOf("UC_flat")),
		);
	});

	it("watches a Channel sitting in users' saved Niches more closely", async () => {
		// Demand is not a fact about the Channel — it is a fact about who is about to look
		// at it. A Channel in a saved Niche is one whose Freshness a user will judge us on.
		const { t, index, demand, channels, settle } = setup([
			flatChannel({ youtubeChannelId: "UC_unsaved" }),
			flatChannel({ youtubeChannelId: "UC_wanted" }),
		]);
		await index("UC_unsaved");
		await index("UC_wanted");

		// Two Channels nobody would otherwise watch closely. One of them is in five saved
		// Niches, and the next claim re-prices it on that.
		await demand("UC_wanted", 5);
		vi.advanceTimersByTime(8 * DAY);
		await t.action(internal.refresh.refreshDueChannels, {});
		await settle();

		const priority = new Map(
			(await channels()).map((channel) => [
				channel.youtubeChannelId,
				channel.refreshPriority ?? 0,
			]),
		);
		expect(priority.get("UC_wanted")).toBeGreaterThan(
			priority.get("UC_unsaved") as number,
		);
	});

	it("spends a short budget on the Channel it is watching most closely", async () => {
		// The ticket in one test: when there is not enough budget for everything that has
		// come due, the crawl goes to the Channel whose stats we most expect to be wrong —
		// not to whichever one the index happens to list first.
		const { t, index, channels, snapshots, settle } = setup([
			flatChannel({ youtubeChannelId: "UC_flat" }),
			aChannel({ youtubeChannelId: "UC_hot" }),
		]);
		await index("UC_flat");
		await index("UC_hot");

		// Long enough that both have come due, and a budget for exactly one of them.
		vi.advanceTimersByTime(8 * DAY);
		await t.action(internal.refresh.refreshDueChannels, { limit: 1 });
		await settle();

		const indexed = await channels();
		const hot = indexed.find(
			(channel) => channel.youtubeChannelId === "UC_hot",
		);
		const flat = indexed.find(
			(channel) => channel.youtubeChannelId === "UC_flat",
		);
		const taken = await snapshots();
		expect(refreshCount(taken, hot?._id)).toBe(2);
		expect(refreshCount(taken, flat?._id)).toBe(1);
	});
});

describe("Crawl Budget", () => {
	it("reports what the day's Refreshes have spent, and what is left", async () => {
		const seeded = ["UC_one", "UC_two"].map((youtubeChannelId) =>
			aChannel({ youtubeChannelId }),
		);
		const { t, index, age, budget, settle } = setup(seeded);
		for (const channel of seeded) {
			await index(channel.youtubeChannelId);
			await age(channel.youtubeChannelId, 30 * DAY);
		}

		await t.action(internal.refresh.refreshDueChannels, {});
		await settle();

		expect(await budget()).toMatchObject({
			spent: 2,
			remaining: DAILY_CRAWL_BUDGET - 2,
			exhaustedRuns: 0,
		});
	});

	it("defers the Refreshes it cannot pay for rather than dropping them", async () => {
		const seeded = aChannel();
		const { t, source, index, age, channels, snapshots, budget, settle } =
			setup([seeded]);
		await index("UC_bonsai");
		await age("UC_bonsai", 30 * DAY);
		await spendTheDay(t);

		source.set({ ...seeded, subscriberCount: 40_000 });
		await t.action(internal.refresh.refreshDueChannels, {});
		await settle();

		// Nothing was crawled — and nothing was lost. The Channel keeps the deadline it
		// came due on, so it is first in line the moment there is budget for it again.
		expect(await snapshots()).toHaveLength(1);
		const [deferred] = await channels();
		expect(deferred?.refreshDueAt).toBeLessThanOrEqual(Date.now());
		// And the shortfall is on the day's ledger: this is the index degrading, and we can
		// see it before a user does.
		expect(await budget()).toMatchObject({ remaining: 0, exhaustedRuns: 1 });
	});

	it("is what actually bounds a day of Refreshing, and not the per-run cap", () => {
		// A per-run cap chosen independently of the budget would quietly become the real
		// constraint: the ledger would show budget going spare every day while Channels sat
		// overdue, and the Crawl Budget we reason about would not be the one we are rationed
		// by. A day of scheduled runs must be able to spend the day.
		expect(CRAWL_BUDGET_PER_RUN * REFRESH_RUNS_PER_DAY).toBeGreaterThanOrEqual(
			DAILY_CRAWL_BUDGET,
		);
	});

	it("Refreshes the deferred Channel once the budget refills", async () => {
		const seeded = aChannel();
		const { t, source, index, age, channels, settle } = setup([seeded]);
		await index("UC_bonsai");
		await age("UC_bonsai", 30 * DAY);
		await spendTheDay(t);

		await t.action(internal.refresh.refreshDueChannels, {});
		await settle();
		source.set({ ...seeded, subscriberCount: 40_000 });

		// Tomorrow: a fresh quota, and the Channel we could not afford yesterday.
		vi.advanceTimersByTime(1 * DAY);
		await t.action(internal.refresh.refreshDueChannels, {});
		await settle();

		const [refreshed] = await channels();
		expect(refreshed?.subscriberCount).toBe(40_000);
	});
});

describe("Growth Metrics", () => {
	/**
	 * A crawl of a Channel as it looks *now*, still uploading so it clears the Entry Bar as
	 * the clock advances: its recent Video is always dated against the current instant, so
	 * the Channel never ages out mid-test and the only thing moving between crawls is the
	 * stats a Growth Metric subtracts. Its Video is namespaced to the Channel so two
	 * Channels in one test do not fight over one Video row.
	 */
	const stillUploading = (
		youtubeChannelId: string,
		subscriberCount: number,
		totalViewCount: number,
	): FakeChannel =>
		aChannel({
			youtubeChannelId,
			subscriberCount,
			totalViewCount,
			videos: [
				{
					...longVideo,
					youtubeVideoId: `${youtubeChannelId}_recent`,
					publishedAt: Date.now() - DAY,
				},
			],
		});

	it("subtracts each window's anchor Snapshot from the current stats", async () => {
		const { source, index, channels } = setup([
			stillUploading("UC_bonsai", 10_000, 3_000_000),
		]);
		// A reading a quarter ago...
		await index("UC_bonsai");

		// ...one a month ago...
		vi.advanceTimersByTime(60 * DAY);
		source.set(stillUploading("UC_bonsai", 15_000, 4_000_000));
		await index("UC_bonsai");

		// ...one a week ago...
		vi.advanceTimersByTime(23 * DAY);
		source.set(stillUploading("UC_bonsai", 19_000, 4_900_000));
		await index("UC_bonsai");

		// ...and today.
		vi.advanceTimersByTime(7 * DAY);
		source.set(stillUploading("UC_bonsai", 20_000, 5_000_000));
		await index("UC_bonsai");

		// 7-day growth is measured against the reading from a week ago, 30-day against a
		// month ago, 90-day against a quarter ago: three different Snapshots subtracted
		// from the one set of current stats give three different numbers.
		const [channel] = await channels();
		expect(channel).toMatchObject({
			subscribersGained7d: 1_000,
			viewsGained7d: 100_000,
			subscribersGained30d: 5_000,
			viewsGained30d: 1_000_000,
			subscribersGained90d: 10_000,
			viewsGained90d: 2_000_000,
		});
	});

	it("reports a window as unavailable, not zero, until a Snapshot old enough anchors it", async () => {
		const { source, index, channels } = setup([
			stillUploading("UC_bonsai", 10_000, 3_000_000),
		]);
		await index("UC_bonsai");

		// Only a week of history: the 7-day window can be measured, the longer ones cannot.
		vi.advanceTimersByTime(7 * DAY);
		source.set(stillUploading("UC_bonsai", 11_000, 3_100_000));
		await index("UC_bonsai");

		const [channel] = await channels();
		expect(channel?.subscribersGained7d).toBe(1_000);
		// Unavailable is absent, not a zero that would call the Channel flat, and not a
		// sentinel that would sort it below a Channel we watched decline.
		expect(channel).not.toHaveProperty("subscribersGained30d");
		expect(channel).not.toHaveProperty("viewsGained30d");
		expect(channel).not.toHaveProperty("subscribersGained90d");
		expect(channel).not.toHaveProperty("viewsGained90d");
	});

	it("reports every window as unavailable on a Channel measured only once", async () => {
		const { index, channels } = setup([
			stillUploading("UC_bonsai", 10_000, 3_000_000),
		]);
		await index("UC_bonsai");

		// Growth is a fact about two Snapshots subtracted, and there is only one. No window
		// can be measured, and none of them is reported as zero.
		const [channel] = await channels();
		for (const window of ["7d", "30d", "90d"]) {
			expect(channel).not.toHaveProperty(`subscribersGained${window}`);
			expect(channel).not.toHaveProperty(`viewsGained${window}`);
		}
	});

	it("gives two Channels with identical current stats but different histories different Growth", async () => {
		const { source, index, channels } = setup([
			stillUploading("UC_climber", 10_000, 3_000_000),
			stillUploading("UC_plateau", 19_000, 4_950_000),
		]);
		await index("UC_climber");
		await index("UC_plateau");

		// A month on, both read exactly 20k subscribers and 5m views...
		vi.advanceTimersByTime(30 * DAY);
		source.set(stillUploading("UC_climber", 20_000, 5_000_000));
		source.set(stillUploading("UC_plateau", 20_000, 5_000_000));
		await index("UC_climber");
		await index("UC_plateau");

		const byId = new Map(
			(await channels()).map((channel) => [channel.youtubeChannelId, channel]),
		);
		const climber = byId.get("UC_climber");
		const plateau = byId.get("UC_plateau");

		// ...but one climbed to get there and the other barely moved, and only Growth,
		// which is a fact about two Snapshots and not about the current one, tells them
		// apart.
		expect(climber?.subscriberCount).toBe(plateau?.subscriberCount);
		expect(climber?.subscribersGained30d).toBe(10_000);
		expect(plateau?.subscribersGained30d).toBe(1_000);
	});
});
