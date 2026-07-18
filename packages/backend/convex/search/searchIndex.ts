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
import { type Infer, type VLiteral, type VOptional, v } from "convex/values";
import { type Signals, signalsValidator } from "../discovery/signals";
import { type Growth, growthValidator } from "../growth";

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

	/**
	 * When we last read this Channel — its Freshness, and the age of every other number on
	 * this document.
	 *
	 * Carried because Refresh is tiered, so Freshness is uneven across the index and is
	 * therefore always shown to the user. A result row is served from this projection alone, so
	 * a Freshness left in Convex is one no row could show; it has to travel with the stats it
	 * qualifies.
	 *
	 * Deliberately *not* a `NumericField`: it is neither a filter nor a sort. It is a date we
	 * display beside a stat to say how much to trust it, not a measure of the Channel — sorting
	 * by it would rank Channels by our own crawl schedule, which is a fact about us rather than
	 * about YouTube, and filtering on it would quietly hide Channels rather than caveat them.
	 */
	lastRefreshedAt: number;

	// Raw stats: filters that scope the competition level, never sorts.
	subscriberCount: number;
	totalViewCount: number;
} & Signals &
	Growth;

/**
 * The raw stats a Channel carries. These scope *competition level* — how hard a niche would
 * be to enter — which is why they are filters and never sorts (see `SortableField`).
 *
 * Named once, here: the `RawStatField` type and the runtime list that excludes them from a
 * sort are both read off this object, so the ban cannot come loose from the type by one of
 * the two gaining a field the other never heard about.
 */
const rawStatValidators = {
	subscriberCount: v.number(),
	totalViewCount: v.number(),
};

export type RawStatField = keyof typeof rawStatValidators;

/**
 * Every field a search may filter on: the raw stats plus every numeric key of the Channel's
 * Signals and Growth Metrics. Derived from those types, not re-listed, so a range or a sort
 * key can only reference a field the projection actually carries — a filter on a field the
 * engine does not hold is a bug caught by the compiler, not an empty result set at runtime —
 * and a new Signal becomes filterable without being named twice.
 */
export type NumericField = RawStatField | keyof Signals | keyof Growth;

/**
 * Every field a search may *sort* on: each filterable field except the raw stats.
 *
 * Sorting by raw subscriber or view count ranks Channels by how hard they are to compete
 * with, which is the exact opposite of the question the product exists to answer — so the
 * ban is expressed in the type rather than left to each caller to remember. A sort on raw
 * size does not fail a review or a validator; it fails to compile. What remains sortable is
 * every *normalised* Signal (each compares a Channel to itself or to its own size) and every
 * Growth Metric, both of which CONTEXT.md holds are sorted directly.
 */
export type SortableField = Exclude<NumericField, RawStatField>;

/**
 * An inclusive numeric range. Either bound may be omitted to leave that side open. Defined as
 * a validator so the public search API can accept a range over the wire without re-declaring
 * its shape, and the type below is read back off it — one definition, not two.
 */
export const numericRangeValidator = v.object({
	min: v.optional(v.number()),
	max: v.optional(v.number()),
});

export type NumericRange = Infer<typeof numericRangeValidator>;

/** One key of a multi-field sort: a field and the direction to order it in. */
export type SortKey = { field: SortableField; direction: "asc" | "desc" };

/**
 * Every numeric field the projection carries, with the validator that defines each. Taken
 * straight from `signalsValidator` and `growthValidator` rather than re-listed, so the fields
 * a search filters on cannot fall out of step with what a Channel is actually projected with,
 * and each field's `optional` is read from the same validator that decides whether a crawl
 * may leave it absent.
 *
 * This is the port's list, not any one engine's: the Typesense collection schema and the
 * public search API's own validators are both built from it, so an engine cannot hold a field
 * the API will not accept a filter on, nor the reverse.
 */
export const numericValidators = {
	...rawStatValidators,
	...signalsValidator.fields,
	...growthValidator.fields,
};

export const NUMERIC_FIELDS = Object.keys(numericValidators) as NumericField[];

/**
 * The sortable fields at runtime — `SortableField` made enumerable, so the public API can
 * build a validator that rejects a sort on raw size rather than silently running it. Filtered
 * from the same list the type is derived from, so the two cannot disagree.
 */
export const SORTABLE_FIELDS = NUMERIC_FIELDS.filter(
	(field): field is SortableField => !(field in rawStatValidators),
);

/**
 * An optional range per numeric field, built from the port's own field list and its own range
 * validator rather than typed out again — so a field the engine stops holding cannot go on
 * being filtered, it stops compiling. This is the wire shape of a set of filters: what the
 * public search API accepts and what a saved Niche stores, one definition serving both so a
 * filter a Niche can hold is exactly a filter a search can run.
 *
 * Raw subscriber and total-view counts *are* here — scoping competition level is what they are
 * for. They are absent only from the sort below.
 */
export const rangeFiltersValidator = v.object(
	Object.fromEntries(
		NUMERIC_FIELDS.map((field) => [field, v.optional(numericRangeValidator)]),
	) as Record<
		(typeof NUMERIC_FIELDS)[number],
		VOptional<typeof numericRangeValidator>
	>,
);

/**
 * The fields a search or a Niche may sort by: every Signal and Growth Metric, and *not* the raw
 * stats. Derived from `SORTABLE_FIELDS`, so the validator offers precisely what `SortableField`
 * permits. The type already stops our own code sorting by raw size at compile time; this is what
 * stops a hand-rolled client — or a doctored Niche — doing it at the wire, where an untyped
 * caller meets the rule.
 */
export const sortFieldValidator = v.union(
	...(SORTABLE_FIELDS.map((field) => v.literal(field)) as [
		VLiteral<SortableField>,
		VLiteral<SortableField>,
		...VLiteral<SortableField>[],
	]),
);

/** One key of a sort at the wire: a sortable field and the direction to order it in. */
export const sortKeyValidator = v.object({
	field: sortFieldValidator,
	direction: v.union(v.literal("asc"), v.literal("desc")),
});

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
	 *
	 * That rule places an absent value at the *high* end of the field, which is the harmless
	 * end only because of an invariant `signalsValidator` happens to hold: every Signal that
	 * can be absent (Momentum, Views per Subscriber, Median Views per Video, Outlier Ratio,
	 * both Form Shares) and every Growth Metric is one where a *higher* number is the more
	 * interesting Channel, so "high" and "not the worst" coincide. The two Signals where a
	 * lower number is the better answer — Upload Cadence (least labour) and Channel Age
	 * (youngest) — are exactly the two the validator marks *required*: a crawl always computes
	 * them, so they are never absent and never sorted by this rule at all.
	 *
	 * Making one of those two optional would break that coincidence: an unmeasured Cadence
	 * would sort as infinitely demanding — the worst answer to "what labour am I signing up
	 * for?" — and this rule would need to become per-field rather than per-direction.
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
		lastRefreshedAt: channel.lastRefreshedAt,
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
