import { convexTest } from "convex-test";
import { afterEach, describe, expect, it } from "vitest";
import {
  createFakeChannelSource,
  type FakeChannel,
} from "../testing/fakeChannelSource";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { type SourceVideo, setChannelSource } from "./discovery/channelSource";
import { MINIMUM_RECENT_VIEWS } from "./discovery/entryBar";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

const DAY = 24 * 60 * 60 * 1000;

/**
 * Fixture Videos are dated relative to the real clock, not a fixed instant: the Entry
 * Bar reads `Date.now()` and measures a 30-day window against it, so a pinned `now`
 * would drift out of that window and start failing these tests on its own.
 */
const now = Date.now();

const longVideo: SourceVideo = {
  youtubeVideoId: "vid_long",
  title: "Repotting a 40-year-old juniper",
  publishedAt: now - 3 * DAY,
  viewCount: 90_000,
  durationSeconds: 14 * 60,
};

const shortVideo: SourceVideo = {
  youtubeVideoId: "vid_short",
  title: "One cut, huge difference",
  publishedAt: now - 1 * DAY,
  viewCount: 800_000,
  durationSeconds: 45,
};

const aChannel = (overrides: Partial<FakeChannel> = {}): FakeChannel => ({
  youtubeChannelId: "UC_bonsai",
  title: "Bonsai Hours",
  description: "Slow television for small trees.",
  handle: "@bonsaihours",
  thumbnailUrl: "https://yt.example/bonsai.jpg",
  subscriberCount: 12_000,
  totalViewCount: 4_000_000,
  videoCount: 2,
  publishedAt: now - 400 * DAY,
  videos: [longVideo, shortVideo],
  ...overrides,
});

const setup = (seed: FakeChannel[]) => {
  const source = createFakeChannelSource(seed);
  setChannelSource(source);
  return { t: convexTest(schema, modules), source };
};

afterEach(() => {
  setChannelSource(null);
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
      videoCount: 2,
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
