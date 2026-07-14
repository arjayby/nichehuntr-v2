import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakeChannelSource,
  type FakeChannel,
} from "../testing/fakeChannelSource";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import crons from "./crons";
import { type SourceVideo, setChannelSource } from "./discovery/channelSource";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 6, 13);

const aVideo: SourceVideo = {
  youtubeVideoId: "vid_long",
  title: "Repotting a 40-year-old juniper",
  publishedAt: now - 3 * DAY,
  viewCount: 90_000,
  durationSeconds: 14 * 60,
};

const aChannel = (overrides: Partial<FakeChannel> = {}): FakeChannel => ({
  youtubeChannelId: "UC_bonsai",
  title: "Bonsai Hours",
  description: "Slow television for small trees.",
  handle: "@bonsaihours",
  subscriberCount: 12_000,
  totalViewCount: 4_000_000,
  videoCount: 120,
  publishedAt: now - 400 * DAY,
  videos: [aVideo],
  ...overrides,
});

const setup = (seed: FakeChannel[]) => {
  const source = createFakeChannelSource(seed);
  setChannelSource(source);
  const t = convexTest(schema, modules);
  return {
    t,
    source,
    /** Runs the crawls a Refresh scheduled, and waits for them to land. */
    settle: () => t.finishAllScheduledFunctions(vi.runAllTimers),
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

describe("Refresh", () => {
  it("appends a Channel Snapshot of the Channel's stats each time it is read", async () => {
    const { t } = setup([aChannel()]);

    await t.action(internal.ingestion.ingestChannel, {
      youtubeChannelId: "UC_bonsai",
    });

    const [channel] = await t.run((ctx) => ctx.db.query("channels").collect());
    const snapshots = await t.run((ctx) =>
      ctx.db.query("channelSnapshots").collect(),
    );
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      channelId: channel?._id,
      subscriberCount: 12_000,
      totalViewCount: 4_000_000,
      videoCount: 120,
    });
    expect(snapshots[0]?.takenAt).toBe(channel?.lastRefreshedAt);
  });

  it("appends rather than overwrites, so history accrues Refresh by Refresh", async () => {
    const seeded = aChannel();
    const { t, source } = setup([seeded]);

    for (const subscriberCount of [12_000, 15_000, 19_000]) {
      source.set({ ...seeded, subscriberCount });
      await t.action(internal.ingestion.ingestChannel, {
        youtubeChannelId: "UC_bonsai",
      });
    }

    const snapshots = await t.run((ctx) =>
      ctx.db.query("channelSnapshots").collect(),
    );
    // Three Refreshes, three measurements. A Snapshot overwritten is a Snapshot
    // lost, and history cannot be backfilled.
    expect(snapshots.map((snapshot) => snapshot.subscriberCount)).toEqual([
      12_000, 15_000, 19_000,
    ]);
  });

  it("updates the Channel's current stats and recomputes its Signals", async () => {
    const seeded = aChannel();
    const { t, source } = setup([seeded]);
    await t.action(internal.ingestion.ingestChannel, {
      youtubeChannelId: "UC_bonsai",
    });

    source.set({
      ...seeded,
      subscriberCount: 24_000,
      totalViewCount: 8_000_000,
      videos: [{ ...aVideo, viewCount: 400_000 }],
    });
    await t.action(internal.ingestion.ingestChannel, {
      youtubeChannelId: "UC_bonsai",
    });

    const channels = await t.run((ctx) => ctx.db.query("channels").collect());
    expect(channels).toHaveLength(1);
    expect(channels[0]).toMatchObject({
      subscriberCount: 24_000,
      totalViewCount: 8_000_000,
      medianViewsPerVideo: 400_000,
      viewsPerSubscriber: 8_000_000 / 24_000,
    });
  });

  it("records the Channel's Freshness, so its stats can be trusted or doubted", async () => {
    const { t } = setup([aChannel()]);
    await t.action(internal.ingestion.ingestChannel, {
      youtubeChannelId: "UC_bonsai",
    });
    const [first] = await t.run((ctx) => ctx.db.query("channels").collect());

    await t.run((ctx) =>
      ctx.db.patch(first?._id as Id<"channels">, {
        lastRefreshedAt: Date.now() - 2 * DAY,
      }),
    );
    await t.action(internal.ingestion.ingestChannel, {
      youtubeChannelId: "UC_bonsai",
    });

    const [refreshed] = await t.run((ctx) =>
      ctx.db.query("channels").collect(),
    );
    expect(refreshed?.lastRefreshedAt).toBeGreaterThan(Date.now() - DAY);
  });
});

describe("refreshDueChannels", () => {
  it("Refreshes the Channels we have not looked at in too long", async () => {
    const seeded = aChannel();
    const { t, source, settle } = setup([seeded]);
    await t.action(internal.ingestion.ingestChannel, {
      youtubeChannelId: "UC_bonsai",
    });
    const [channel] = await t.run((ctx) => ctx.db.query("channels").collect());
    await t.run((ctx) =>
      ctx.db.patch(channel?._id as Id<"channels">, {
        lastRefreshedAt: Date.now() - 30 * DAY,
      }),
    );

    // The Channel kept growing while we were not looking.
    source.set({ ...seeded, subscriberCount: 40_000 });
    await t.action(internal.refresh.refreshDueChannels, {});
    await settle();

    const [refreshed] = await t.run((ctx) =>
      ctx.db.query("channels").collect(),
    );
    expect(refreshed?.subscriberCount).toBe(40_000);

    const snapshots = await t.run((ctx) =>
      ctx.db.query("channelSnapshots").collect(),
    );
    expect(snapshots.map((snapshot) => snapshot.subscriberCount)).toEqual([
      12_000, 40_000,
    ]);
  });

  it("leaves a Channel we have just read alone, so no Crawl Budget is wasted", async () => {
    const seeded = aChannel();
    const { t, source, settle } = setup([seeded]);
    await t.action(internal.ingestion.ingestChannel, {
      youtubeChannelId: "UC_bonsai",
    });

    source.set({ ...seeded, subscriberCount: 40_000 });
    await t.action(internal.refresh.refreshDueChannels, {});
    await settle();

    const [channel] = await t.run((ctx) => ctx.db.query("channels").collect());
    expect(channel?.subscriberCount).toBe(12_000);
    const snapshots = await t.run((ctx) =>
      ctx.db.query("channelSnapshots").collect(),
    );
    expect(snapshots).toHaveLength(1);
  });

  it("spends its batch on the Channels we have looked at least recently", async () => {
    const channels = [
      aChannel({ youtubeChannelId: "UC_stalest" }),
      aChannel({ youtubeChannelId: "UC_stale" }),
      aChannel({ youtubeChannelId: "UC_recent" }),
    ];
    const { t, settle } = setup(channels);
    for (const channel of channels) {
      await t.action(internal.ingestion.ingestChannel, {
        youtubeChannelId: channel.youtubeChannelId,
      });
    }
    const staleness: Record<string, number> = {
      UC_stalest: 90 * DAY,
      UC_stale: 30 * DAY,
      UC_recent: 10 * DAY,
    };
    await t.run(async (ctx) => {
      for (const channel of await ctx.db.query("channels").collect()) {
        await ctx.db.patch(channel._id, {
          lastRefreshedAt:
            Date.now() - (staleness[channel.youtubeChannelId] as number),
        });
      }
    });

    // A budget of two: the two Channels we have looked at least recently.
    await t.action(internal.refresh.refreshDueChannels, { limit: 2 });
    await settle();

    const rows = await t.run((ctx) => ctx.db.query("channels").collect());
    const refreshedAt = new Map(
      rows.map((row) => [row.youtubeChannelId, row.lastRefreshedAt]),
    );
    const cutoff = Date.now() - DAY;
    expect(refreshedAt.get("UC_stalest")).toBeGreaterThan(cutoff);
    expect(refreshedAt.get("UC_stale")).toBeGreaterThan(cutoff);
    expect(refreshedAt.get("UC_recent")).toBeLessThan(cutoff);
  });

  it("Refreshes the rest of the batch when one Channel's crawl fails", async () => {
    const seeded = [
      aChannel({ youtubeChannelId: "UC_gone" }),
      aChannel({ youtubeChannelId: "UC_alive" }),
    ];
    const { t, source, settle } = setup(seeded);
    for (const channel of seeded) {
      await t.action(internal.ingestion.ingestChannel, {
        youtubeChannelId: channel.youtubeChannelId,
      });
    }
    await t.run(async (ctx) => {
      for (const channel of await ctx.db.query("channels").collect()) {
        await ctx.db.patch(channel._id, {
          lastRefreshedAt: Date.now() - 30 * DAY,
        });
      }
    });

    // The Channel was deleted on YouTube between crawls: the source no longer has it.
    source.remove("UC_gone");
    source.set({
      ...(seeded[1] as FakeChannel),
      subscriberCount: 40_000,
    });
    await t.action(internal.refresh.refreshDueChannels, {});
    await settle();

    const alive = await t.run((ctx) =>
      ctx.db
        .query("channels")
        .withIndex("by_youtube_channel_id", (q) =>
          q.eq("youtubeChannelId", "UC_alive"),
        )
        .unique(),
    );
    expect(alive?.subscriberCount).toBe(40_000);
  });

  it("is scheduled, so history accrues without anyone asking for it", () => {
    // A Refresh that only ran on demand would record history only for the Channels
    // somebody happened to look at — and the days it did not run are not recoverable.
    const scheduled = Object.values(crons.crons);
    expect(scheduled).toContainEqual(
      expect.objectContaining({ name: "refresh:refreshDueChannels" }),
    );
  });
});
