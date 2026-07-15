import type {
	NumericField,
	NumericRange,
	SearchDocument,
	SearchIndex,
	SearchQuery,
	SortKey,
} from "../convex/search/searchIndex";

/**
 * An in-memory SearchIndex. Every search test queries through this, so it must behave like
 * the real engine on the two things downstream tickets lean on — numeric ranges and
 * multi-field sorts — or a test that passes here would fail in production and the suite
 * would be lying (see `docs/adr/0001-external-search-engine-for-channel-search.md`).
 *
 * It deliberately does *not* replicate the real engine's typo tolerance or relevance
 * ranking: keyword matching here is a plain token-containment test, enough to prove a
 * Channel is matched on its title, description and Video titles, but not a stand-in for the
 * engine's fuzzy search. Ranges and sorts are the load-bearing semantics; those are exact.
 *
 * It lives outside `convex/` on purpose: Convex bundles everything under that directory
 * except `_generated` and `*.test.ts`, and a fake engine has no business being deployed.
 */
export function createFakeSearchIndex(
	seed: SearchDocument[] = [],
): SearchIndex {
	const documents = new Map<string, SearchDocument>(
		seed.map((document) => [document.youtubeChannelId, document]),
	);

	return {
		async upsert(incoming) {
			for (const document of incoming) {
				documents.set(document.youtubeChannelId, document);
			}
		},

		async query(query) {
			const matched = [...documents.values()].filter((document) =>
				matches(document, query),
			);

			const found = matched.length;
			const ordered = query.sort
				? [...matched].sort((a, b) =>
						compareBySort(a, b, query.sort as SortKey[]),
					)
				: matched;

			const offset = query.offset ?? 0;
			const end = query.limit === undefined ? undefined : offset + query.limit;
			return { documents: ordered.slice(offset, end), found };
		},
	};
}

/** Whether a document clears every filter the query names. */
function matches(document: SearchDocument, query: SearchQuery): boolean {
	const requireEntryBar = query.meetsEntryBar ?? true;
	if (requireEntryBar && !document.meetsEntryBar) {
		return false;
	}

	if (!matchesKeyword(document, query.keyword)) {
		return false;
	}

	for (const [field, range] of Object.entries(query.ranges ?? {})) {
		if (!inRange(document[field as NumericField], range as NumericRange)) {
			return false;
		}
	}

	return true;
}

/**
 * Every token of the keyword must appear (case-insensitively) somewhere in the Channel's
 * searchable text — its title, its description, or one of its Video titles. Multiple tokens
 * are ANDed: "bonsai juniper" matches only a Channel whose text contains both words.
 *
 * This is a deliberate simplification, not a mirror of Typesense's keyword ranking: the real
 * engine adds typo tolerance and relevance ordering and may relax tokens a strict AND would
 * drop. The parity that has to hold exactly — and does — is numeric ranges and multi-field
 * sort (see this module's header); keyword matching here only has to prove a Channel is found
 * on its title, description and Video titles.
 */
function matchesKeyword(
	document: SearchDocument,
	keyword: string | undefined,
): boolean {
	if (keyword === undefined || keyword.trim() === "") {
		return true;
	}
	const haystack = [
		document.title,
		document.description,
		...document.videoTitles,
	]
		.join(" ")
		.toLowerCase();
	return keyword
		.toLowerCase()
		.split(/\s+/)
		.filter((token) => token !== "")
		.every((token) => haystack.includes(token));
}

/**
 * Whether a value falls inside an inclusive range. An absent value is *out* of every range:
 * a Channel with no momentum cannot satisfy a filter on momentum, because "unknown" is not a
 * number that clears a bar.
 */
function inRange(value: number | undefined, range: NumericRange): boolean {
	if (value === undefined) {
		return false;
	}
	if (range.min !== undefined && value < range.min) {
		return false;
	}
	if (range.max !== undefined && value > range.max) {
		return false;
	}
	return true;
}

/**
 * Compares two documents by the sort keys in order, falling through to the next key on a
 * tie.
 *
 * An absent value is compared as `+Infinity` — it sorts to the *favourable* end of whatever
 * direction is asked for: the top of a descending sort, the bottom of an ascending one. This
 * is the sort placement growth.ts requires: a search must never rank a Channel it has not
 * measured below one it has watched decline. Placing absent at the favourable end satisfies
 * that in either direction, and — unlike a neutral origin — it is exactly what the real
 * engine can express (Typesense's `missing_values: first` on a descending sort, `last` on an
 * ascending one), so this fake and the engine order missing values the same way. It is a
 * placement rule for ordering only; the value is still stored and filtered as absent.
 */
function compareBySort(
	a: SearchDocument,
	b: SearchDocument,
	sort: SortKey[],
): number {
	for (const { field, direction } of sort) {
		const left = a[field] ?? Number.POSITIVE_INFINITY;
		const right = b[field] ?? Number.POSITIVE_INFINITY;
		if (left !== right) {
			const ascending = left < right ? -1 : 1;
			return direction === "asc" ? ascending : -ascending;
		}
	}
	return 0;
}
