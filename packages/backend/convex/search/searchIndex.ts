/**
 * The SearchIndex port: the one interface over the external search engine that serves
 * user-facing Channel search. Convex stays the system of record; the engine holds a
 * *projection* of Channel documents — derived data, rebuildable from Convex at any time
 * (see `docs/adr/0001-external-search-engine-for-channel-search.md`).
 *
 * Search cannot run on Convex: the canonical query combines full-text keywords with
 * several simultaneous numeric ranges and an arbitrary sort, none of which a Convex index
 * expresses. So a dedicated engine holds a flat projection of each Channel and answers the
 * query. Everything the engine is asked to do passes through this port and nowhere else,
 * so swapping engines — or standing up an in-memory fake for tests — happens here alone.
 *
 * The fake (see `testing/fakeSearchIndex.ts`) must not diverge from the real engine on the
 * two things downstream tickets sort and filter on — numeric ranges and multi-field sorts
 * — or the whole suite would be testing a search that behaves differently in production.
 */
import type { Signals } from "../discovery/signals";
import type { Growth } from "../growth";

/**
 * A Channel projected into the search engine: flat, self-contained, and keyed on the
 * Channel's YouTube id. It carries exactly what search needs — the text a keyword matches,
 * the numbers a range filters and a sort orders, and the Entry Bar flag that gates whether
 * the Channel is searchable at all — and nothing a search never reads.
 *
 * Its numbers *are* the Channel's Signals and Growth Metrics, taken straight from their
 * validators (`Signals`, `Growth`) rather than re-typed here, so the projection cannot drift
 * from what a crawl computes — a new Signal reaches search by being a Signal, not by being
 * copied into a second list. Each is absent — never zero — when genuinely unknowable, so a
 * search never ranks a Channel it knows nothing about as the worst Channel it knows.
 *
 * The projection's shape is a product surface: adding a filter or a sort means projecting a
 * new field here, not just storing one in Convex.
 */
export type SearchDocument = {
	/** The document id in the engine: a Channel projects to exactly one document. */
	youtubeChannelId: string;

	// The text a keyword matches. A search matches a Channel on its own words *and* on the
	// words of the Videos it makes, because a niche lives in Video titles as much as in the
	// Channel's description.
	title: string;
	description: string;
	/** The titles of the Channel's recent Videos — matched, though Videos are not searched. */
	videoTitles: string[];

	/**
	 * Whether the Channel clears the Entry Bar. Only Channels that do are searchable; a
	 * Channel that has gone quiet is projected with this `false` so it drops out of results,
	 * rather than being deleted, so a rebuild and an incremental sync agree on what the
	 * engine holds. Search filters on it by default.
	 */
	meetsEntryBar: boolean;

	// Raw stats: filters that scope the competition level, never sorts.
	subscriberCount: number;
	totalViewCount: number;
} & Signals &
	Growth;

/**
 * Every field a search may filter or sort on: the raw stats plus every numeric key of the
 * Channel's Signals and Growth Metrics. Derived from those types, not re-listed, so a range
 * or a sort key can only reference a field the projection actually carries — a filter on a
 * field the engine does not hold is a bug caught by the compiler, not an empty result set at
 * runtime — and a new Signal becomes filterable without being named twice.
 */
export type NumericField =
	| "subscriberCount"
	| "totalViewCount"
	| keyof Signals
	| keyof Growth;

/** An inclusive numeric range. Either bound may be omitted to leave that side open. */
export type NumericRange = { min?: number; max?: number };

/** One key of a multi-field sort: a field and the direction to order it in. */
export type SortKey = { field: NumericField; direction: "asc" | "desc" };

export type SearchQuery = {
	/**
	 * Full-text over the Channel's title, description, and its Videos' titles. Absent or
	 * empty matches every Channel — a filter-and-sort with no keyword is a valid search.
	 */
	keyword?: string;
	/**
	 * Numeric range filters, keyed by field. A Channel passes only if every field it is
	 * filtered on is present and falls inside its range: a range over a Signal a Channel
	 * does not have excludes it, because "momentum at least 1" is a claim an unmeasured
	 * Channel cannot meet.
	 */
	ranges?: Partial<Record<NumericField, NumericRange>>;
	/**
	 * Whether to require Channels that clear the Entry Bar. Defaults to `true`: an ordinary
	 * search sees only the searchable index. A rebuild or an audit can pass `false` to see
	 * every projected Channel, flagged and all.
	 */
	meetsEntryBar?: boolean;
	/**
	 * The sort, most significant key first; later keys break ties. Absent leaves the order
	 * unspecified. An absent value on a sorted field orders as *not the worst* — see
	 * `compareBySort` in the fake — so an unmeasured Channel never sorts below one the index
	 * watched decline.
	 */
	sort?: SortKey[];
	/** How many documents to return. */
	limit?: number;
	/** How many leading matches to skip, for pagination. */
	offset?: number;
};

/**
 * The result of a query: the page of documents asked for, and how many Channels matched in
 * total before pagination — the count a Niche needs to answer "how many Channels are in
 * this set", which a single page cannot give.
 */
export type SearchResult = {
	documents: SearchDocument[];
	found: number;
};

export type SearchIndex = {
	/** Projects Channels into the engine, replacing any document with the same id. */
	upsert(documents: SearchDocument[]): Promise<void>;
	query(query: SearchQuery): Promise<SearchResult>;
};

/**
 * The fields of a Channel a projection is built from: a `SearchDocument` minus the Video
 * titles, which come from the Channel's Videos rather than the Channel itself. A `channels`
 * document is a superset of this, so one can be handed in whole.
 */
export type ProjectableChannel = Omit<SearchDocument, "videoTitles">;

/**
 * Builds a Channel's search projection from the Channel and the titles of its recent Videos.
 * Pure, and deliberately field-by-field rather than a spread: the Channel handed in carries
 * more than search needs (its Refresh schedule, its volatility), and copying named fields is
 * what keeps those off the projection. The explicit list is also the completeness check —
 * TypeScript will not let a `SearchDocument` field go unset — so the projection a crawl writes
 * and the one a rebuild writes are the same document.
 */
export function projectChannel(
	channel: ProjectableChannel,
	videoTitles: string[],
): SearchDocument {
	return {
		youtubeChannelId: channel.youtubeChannelId,
		title: channel.title,
		description: channel.description,
		videoTitles,
		meetsEntryBar: channel.meetsEntryBar,
		subscriberCount: channel.subscriberCount,
		totalViewCount: channel.totalViewCount,
		momentum: channel.momentum,
		viewsPerSubscriber: channel.viewsPerSubscriber,
		medianViewsPerVideo: channel.medianViewsPerVideo,
		outlierRatio: channel.outlierRatio,
		uploadCadencePerWeek: channel.uploadCadencePerWeek,
		channelAgeDays: channel.channelAgeDays,
		shortsUploadShare: channel.shortsUploadShare,
		shortsViewShare: channel.shortsViewShare,
		subscribersGained7d: channel.subscribersGained7d,
		viewsGained7d: channel.viewsGained7d,
		subscribersGained30d: channel.subscribersGained30d,
		viewsGained30d: channel.viewsGained30d,
		subscribersGained90d: channel.subscribersGained90d,
		viewsGained90d: channel.viewsGained90d,
	};
}

let configuredIndex: SearchIndex | null = null;

/**
 * Installs the SearchIndex every projection and search runs through. Tests install the
 * in-memory fake here; production installs the real engine adapter.
 */
export function setSearchIndex(index: SearchIndex | null): void {
	configuredIndex = index;
}

export function getSearchIndex(): SearchIndex {
	if (configuredIndex === null) {
		throw new Error("No SearchIndex configured");
	}
	return configuredIndex;
}
