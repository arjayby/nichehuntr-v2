/**
 * The Channels and Videos every crawl test is written against, so that a fixture's
 * numbers mean the same thing in every file that reads them.
 */
import type { SourceVideo } from "../convex/discovery/channelSource";
import type { FakeChannel } from "./fakeChannelSource";

export const DAY = 24 * 60 * 60 * 1000;

/** The clock the fixtures are dated against. Tests pass it wherever `now` is needed. */
export const NOW = Date.UTC(2026, 6, 13);

export const longVideo: SourceVideo = {
  youtubeVideoId: "vid_long",
  title: "Repotting a 40-year-old juniper",
  publishedAt: NOW - 3 * DAY,
  viewCount: 90_000,
  durationSeconds: 14 * 60,
};

export const shortVideo: SourceVideo = {
  youtubeVideoId: "vid_short",
  title: "One cut, huge difference",
  publishedAt: NOW - 1 * DAY,
  viewCount: 800_000,
  durationSeconds: 45,
};

/**
 * A Channel with a back-catalogue of 120 Videos and 4m lifetime views — a lifetime
 * average Video of ~33k — of which a crawl returns only the two most recent. Those two
 * are doing far better than that average, so this is a Channel heating up.
 */
export const aChannel = (
  overrides: Partial<FakeChannel> = {},
): FakeChannel => ({
  youtubeChannelId: "UC_bonsai",
  title: "Bonsai Hours",
  description: "Slow television for small trees.",
  handle: "@bonsaihours",
  thumbnailUrl: "https://yt.example/bonsai.jpg",
  subscriberCount: 12_000,
  totalViewCount: 4_000_000,
  videoCount: 120,
  publishedAt: NOW - 400 * DAY,
  videos: [longVideo, shortVideo],
  ...overrides,
});
