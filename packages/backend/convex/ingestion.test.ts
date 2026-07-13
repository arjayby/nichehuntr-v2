import { convexTest } from "convex-test";
import { afterEach, describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { setChannelSource, type SourceVideo } from "./discovery/channelSource";
import {
  createFakeChannelSource,
  type FakeChannel,
} from "../testing/fakeChannelSource";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 6, 13);

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
        viewCount: 1_000,
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
