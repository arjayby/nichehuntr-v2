/**
 * The Channels the search screen's tests are written against — a Channel as the search engine
 * hands it back, so a fixture here means what a real result row means.
 */
import type {
	ChannelDetail,
	ChannelDetailVideo,
} from "@nichehuntr-v2/backend/convex/channels/detail";
import type { SearchDocument } from "@nichehuntr-v2/backend/convex/search/searchIndex";

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;

/** The clock the fixtures are dated against. Tests pass it wherever `now` is needed. */
export const NOW = Date.UTC(2026, 6, 16, 12, 0, 0);

/**
 * A Channel in the index, with sane defaults, so a test states only the fields it is about.
 *
 * Every optional Signal is absent unless a test sets one — an unmeasured Channel is the
 * default, because that is what a freshly discovered Channel actually is.
 */
export const aChannel = (
	overrides: Partial<SearchDocument> = {},
): SearchDocument => ({
	youtubeChannelId: "UC_bonsai",
	title: "Bonsai Hours",
	description: "Slow television for small trees.",
	videoTitles: ["Repotting a juniper", "One cut, huge difference"],
	meetsEntryBar: true,
	lastRefreshedAt: NOW - 2 * HOUR,
	subscriberCount: 12_000,
	totalViewCount: 4_000_000,
	uploadCadencePerWeek: 2,
	channelAgeDays: 400,
	...overrides,
});

/** A recent Video on a Channel's detail, with sane defaults so a test states only its point. */
export const aVideo = (
	overrides: Partial<ChannelDetailVideo> = {},
): ChannelDetailVideo => ({
	youtubeVideoId: "vid_repot",
	title: "Repotting a 40-year-old juniper",
	publishedAt: NOW - 3 * DAY,
	viewCount: 90_000,
	form: "longform",
	viewsVsMedian: 1.2,
	isOutlier: false,
	...overrides,
});

/**
 * A Channel as its detail read hands it back — every Signal on the one Channel, its recent
 * Videos, and which of them broke out. The defaults are the heating-up Channel the search
 * fixtures also describe, so a Channel means one thing whether a test lists it or opens it.
 */
export const aChannelDetail = (
	overrides: Partial<ChannelDetail> = {},
): ChannelDetail => ({
	youtubeChannelId: "UC_bonsai",
	title: "Bonsai Hours",
	description: "Slow television for small trees.",
	handle: "@bonsaihours",
	subscriberCount: 12_000,
	totalViewCount: 4_000_000,
	lastRefreshedAt: NOW - 2 * HOUR,
	meetsEntryBar: true,
	momentum: 2.3,
	viewsPerSubscriber: 333,
	medianViewsPerVideo: 33_000,
	outlierRatio: 4.1,
	uploadCadencePerWeek: 2,
	channelAgeDays: 400,
	shortsUploadShare: 0.2,
	shortsViewShare: 0.85,
	videos: [
		aVideo({
			youtubeVideoId: "vid_break",
			title: "One cut, huge difference",
			publishedAt: NOW - 1 * DAY,
			viewCount: 800_000,
			form: "short",
			viewsVsMedian: 24,
			isOutlier: true,
		}),
		aVideo(),
	],
	...overrides,
});
