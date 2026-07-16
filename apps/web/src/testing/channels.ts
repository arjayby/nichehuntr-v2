/**
 * The Channels the search screen's tests are written against — a Channel as the search engine
 * hands it back, so a fixture here means what a real result row means.
 */
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
