/**
 * The Channels and Videos every crawl test is written against, so that a fixture's
 * numbers mean the same thing in every file that reads them.
 */
import type { SourceVideo } from "../convex/discovery/channelSource";
import type { FakeChannel } from "./fakeChannelSource";

export const DAY = 24 * 60 * 60 * 1000;

/**
 * The clock the fixtures are dated against. Tests pass it wherever `now` is needed.
 *
 * The real clock, not a pinned instant: a crawl judges a Channel against the Entry Bar
 * and computes its Signals as of `Date.now()`, and both measure a 30-day window back
 * from it. Fixtures pinned to a fixed date would sail out of that window as real time
 * passed, and these tests would start failing on a day nobody touched the code.
 */
export const NOW = Date.now();

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

/** A Video doing exactly what this Channel's lifetime average Video does: 4m / 120. */
export const averageVideo: SourceVideo = {
	youtubeVideoId: "vid_average",
	title: "Watering, again",
	publishedAt: NOW - 3 * DAY,
	viewCount: 33_333,
	durationSeconds: 11 * 60,
};

/**
 * A Channel performing at its own lifetime average — a Momentum of 1. It clears the
 * Entry Bar and is worth indexing; it is simply not heating up, and so is not worth
 * watching closely. The counterweight to `aChannel` in every priority test.
 */
export const flatChannel = (
	overrides: Partial<FakeChannel> = {},
): FakeChannel =>
	aChannel({
		youtubeChannelId: "UC_flat",
		videos: [averageVideo],
		...overrides,
	});
