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
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { setChannelSource } from "./discovery/channelSource";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

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
    // Nothing published inside the recent window: this Channel has no Momentum, and a
    // stored zero would sort it below every Channel that is merely cooling off.
    const { t } = setup([
      aChannel({
        subscriberCount: 0,
        videos: [{ ...longVideo, publishedAt: now - 120 * DAY }],
      }),
    ]);

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
