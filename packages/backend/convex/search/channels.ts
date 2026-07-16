/**
 * The user-facing Channel search: the canonical nichehuntr query, and the reason an external
 * engine exists at all (see `docs/adr/0001-external-search-engine-for-channel-search.md`).
 *
 *   text "scary stories" AND subscribers 10k–200k AND shortsViewShare > 0.7
 *   AND momentum > 2.0 SORT BY momentum DESC PAGINATE
 *
 * Several simultaneous numeric ranges plus an arbitrary sort over a keyword match — none of
 * which a Convex index expresses. This module is thin on purpose: the query semantics live in
 * the SearchIndex port, and everything here is the *product* surface over them — which fields
 * a user may filter on, which they may sort by, and how much of the index one search may take
 * at a time.
 *
 * It is an action, not a query: the engine is reached over HTTP, so a search cannot be a
 * reactive Convex query. Search is free and unmetered on every plan (Credits meter Discovery,
 * not search — `docs/adr/0002-credits-meter-discovery-not-search.md`), so nothing here spends
 * a Credit or takes a Crawl Budget.
 */
import { type VLiteral, type VOptional, v } from "convex/values";
import { action } from "../_generated/server";
import {
	getSearchIndex,
	NUMERIC_FIELDS,
	numericRangeValidator,
	type SearchDocument,
	SORTABLE_FIELDS,
	type SortableField,
} from "./searchIndex";

/**
 * How many Channels a search returns when it does not say, and the most it will return
 * however loudly it asks. The cap is what stops one search from paging the whole index out of
 * the engine in a single call.
 */
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/**
 * An optional range filter per numeric field, built from the port's own field list and its own
 * range validator rather than typed out again — so a new Signal becomes filterable by being a
 * Signal, and a filter can never name a field the engine does not hold.
 *
 * Raw subscriber and total-view counts *are* here: scoping competition level is exactly what
 * they are for. They are absent only from the sort below.
 */
const filtersValidator = v.object(
	Object.fromEntries(
		NUMERIC_FIELDS.map((field) => [field, v.optional(numericRangeValidator)]),
	) as Record<
		(typeof NUMERIC_FIELDS)[number],
		VOptional<typeof numericRangeValidator>
	>,
);

/**
 * The fields a search may sort by: every Signal and Growth Metric, and *not* the raw stats.
 *
 * Derived from `SORTABLE_FIELDS`, which is `SortableField` made enumerable, so this validator
 * offers precisely what the type permits. The type already stops our own code sorting by raw
 * size at compile time; this is what stops a hand-rolled client doing it at runtime — the
 * ban has to hold at the wire, because that is where an untyped caller meets it.
 */
const sortFieldValidator = v.union(
	...(SORTABLE_FIELDS.map((field) => v.literal(field)) as [
		VLiteral<SortableField>,
		VLiteral<SortableField>,
		...VLiteral<SortableField>[],
	]),
);

const sortKeyValidator = v.object({
	field: sortFieldValidator,
	direction: v.union(v.literal("asc"), v.literal("desc")),
});

/**
 * A page of matching Channels, and how many matched the criteria in total.
 *
 * `found` counts the whole match, not the page — it is the number a Niche is measured by
 * ("how many Channels are in this set, and is that growing?"), which is a set-level question
 * one page of results could never answer.
 */
export type ChannelSearchPage = {
	channels: SearchDocument[];
	found: number;
	page: number;
	pageSize: number;
};

export const searchChannels = action({
	args: {
		/** Matches the Channel's title, description, and its Videos' titles. */
		keyword: v.optional(v.string()),
		filters: v.optional(filtersValidator),
		/** Most significant key first; later keys break ties. */
		sort: v.optional(v.array(sortKeyValidator)),
		/** 0-based. */
		page: v.optional(v.number()),
		pageSize: v.optional(v.number()),
	},
	handler: async (
		_ctx,
		{ keyword, filters, sort, page, pageSize },
	): Promise<ChannelSearchPage> => {
		// `v.number()` is a float64: it admits a negative, a fraction, a NaN and an Infinity,
		// none of which name a page. Rejected rather than rounded, because a client asking for
		// page -1 or page 1.5 has a bug, and quietly serving it page 0 or page 1 would hide it.
		const index = page ?? 0;
		if (!Number.isInteger(index) || index < 0) {
			throw new Error(
				`A search must ask for a whole, non-negative page; got page ${page}`,
			);
		}
		// A page size, by contrast, *is* clamped: a client asking for more than the maximum is
		// being greedy, not wrong, and the most it can have is a full page.
		const size = Math.min(pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
		if (!Number.isInteger(size) || size < 1) {
			throw new Error(
				`A search must ask for a whole page of at least one Channel; got pageSize ${pageSize}`,
			);
		}

		const { documents, found } = await getSearchIndex().query({
			keyword,
			ranges: filters,
			sort,
			// Whole pages only: an offset is always a multiple of the page size, which is the
			// only offset the real engine can honour exactly (Typesense paginates in pages, and
			// floors anything else). Offering an arbitrary offset here would be offering one the
			// fake could serve and production could not.
			offset: index * size,
			limit: size,
		});

		return { channels: documents, found, page: index, pageSize: size };
	},
});
