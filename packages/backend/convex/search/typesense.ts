/**
 * The real SearchIndex: a Typesense adapter. This is the production engine behind the port
 * the fake stands in for in tests (see `searchIndex.ts` and
 * `docs/adr/0001-external-search-engine-for-channel-search.md`).
 *
 * Typesense is self-hosted and priced by the box it runs on, never per search
 * (`docs/adr/0004-typesense-is-the-search-engine.md`). Search sits underneath a credit-based
 * pricing model and users search constantly, so a per-search fee would put an uncontrolled
 * variable cost directly under our margin — "search must be effectively free at the margin."
 *
 * It talks to Typesense over its HTTP API with `fetch`, so it carries no client dependency
 * and runs inside a Convex action unchanged. Everything below is a translation of this port
 * into Typesense's query language; the fake in `testing/fakeSearchIndex.ts` mirrors the same
 * semantics — keyword over title/description/videoTitles, inclusive numeric ranges,
 * multi-field sort with missing values at the favourable end — so the suite tests the search
 * production actually runs.
 */
import {
	NUMERIC_FIELDS,
	numericValidators,
	type SearchDocument,
	type SearchIndex,
	type SearchQuery,
	type SortKey,
} from "./searchIndex";

/** The Typesense collection Channels are projected into. */
export const CHANNELS_COLLECTION = "channels";

/** The fields a keyword matches, in Typesense's `query_by` order. */
const QUERY_BY = ["title", "description", "videoTitles"] as const;

/**
 * The numeric fields a crawl always sets — the ones the port's validators mark required. The
 * field list itself is the port's (`numericValidators`), so the collection this adapter
 * creates holds exactly the fields the rest of the app filters and sorts on.
 */
const REQUIRED_NUMERIC = new Set(
	Object.entries(numericValidators)
		.filter(([, validator]) => validator.isOptional === "required")
		.map(([name]) => name),
);

export type TypesenseConfig = {
	/** The Typesense node, e.g. `https://search.internal:8108`. */
	url: string;
	apiKey: string;
	collection?: string;
};

/**
 * The collection schema Channels are projected into. Optional Signals and Growth Metrics are
 * declared `optional` so a Channel may be projected without them — an absent value is stored
 * as absent, never as a zero, exactly as it is held in Convex.
 */
export function channelsCollectionSchema(collection = CHANNELS_COLLECTION) {
	return {
		name: collection,
		fields: [
			{ name: "youtubeChannelId", type: "string" },
			{ name: "title", type: "string" },
			{ name: "description", type: "string" },
			{ name: "videoTitles", type: "string[]" },
			{ name: "meetsEntryBar", type: "bool" },
			...NUMERIC_FIELDS.map((field) => ({
				name: field,
				type: "float",
				optional: !REQUIRED_NUMERIC.has(field),
			})),
		],
	};
}

type TypesenseRequest = RequestInit & { rawBody?: string };

/**
 * One request to a Typesense node: attaches the API key, sends the body, and turns any
 * non-2xx into an error carrying Typesense's own message. Shared by the search operations and
 * the collection administration below, so authentication and error handling live in one place.
 */
async function typesenseRequest(
	config: TypesenseConfig,
	path: string,
	init: TypesenseRequest = {},
): Promise<Response> {
	const base = config.url.replace(/\/$/, "");
	const { rawBody, ...rest } = init;
	const response = await fetch(`${base}${path}`, {
		...rest,
		body: rawBody ?? rest.body,
		headers: {
			"X-TYPESENSE-API-KEY": config.apiKey,
			...(rest.headers ?? {}),
		},
	});
	if (!response.ok) {
		throw new Error(
			`Typesense ${init.method ?? "GET"} ${path} failed: ${response.status} ${await response.text()}`,
		);
	}
	return response;
}

/**
 * Stands the collection up empty: drops it if it is there, then creates it from the schema.
 * This is the from-scratch step a full rebuild begins with — `rebuildProjection` (see
 * `rebuild.ts`) only *writes* documents, so recreating the collection here is what makes a
 * rebuild against a live engine a true rebuild rather than an overlay left on top of stale
 * rows. Kept off the `SearchIndex` port on purpose: it is Typesense collection administration,
 * run once before a rebuild, not a search the rest of the app performs.
 */
export async function recreateChannelsCollection(
	config: TypesenseConfig,
): Promise<void> {
	const collection = config.collection ?? CHANNELS_COLLECTION;

	// A 404 means there was nothing to drop — the ordinary case on a first build.
	const dropped = await typesenseRequest(config, `/collections/${collection}`, {
		method: "DELETE",
	}).catch((error: unknown) => error);
	if (dropped instanceof Error && !/failed: 404/.test(dropped.message)) {
		throw dropped;
	}

	await typesenseRequest(config, "/collections", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		rawBody: JSON.stringify(channelsCollectionSchema(collection)),
	});
}

/**
 * Builds the SearchIndex backed by a Typesense collection. Installed in production the way a
 * test installs the fake — through `setSearchIndex` — so nothing above this port knows which
 * engine answers a search.
 */
export function createTypesenseSearchIndex(
	config: TypesenseConfig,
): SearchIndex {
	const collection = config.collection ?? CHANNELS_COLLECTION;
	const request = (path: string, init?: TypesenseRequest) =>
		typesenseRequest(config, path, init);

	return {
		async upsert(documents) {
			if (documents.length === 0) {
				return;
			}
			// The import endpoint takes newline-delimited JSON, one document per line. `upsert`
			// replaces any document with the same id, so re-projecting a Channel overwrites its
			// row rather than duplicating it.
			const body = documents
				.map((document) => JSON.stringify(document))
				.join("\n");
			await request(
				`/collections/${collection}/documents/import?action=upsert`,
				{
					method: "POST",
					headers: { "Content-Type": "text/plain" },
					rawBody: body,
				},
			);
		},

		async query(query) {
			const params = new URLSearchParams({
				q: query.keyword?.trim() ? query.keyword : "*",
				query_by: QUERY_BY.join(","),
				per_page: String(query.limit ?? 20),
				page: String(pageFor(query)),
			});
			const filter = filterBy(query);
			if (filter) {
				params.set("filter_by", filter);
			}
			if (query.sort && query.sort.length > 0) {
				params.set("sort_by", sortBy(query.sort));
			}

			const response = await request(
				`/collections/${collection}/documents/search?${params.toString()}`,
			);
			const body = (await response.json()) as {
				found: number;
				hits: { document: SearchDocument }[];
			};
			return {
				found: body.found,
				documents: body.hits.map((hit) => hit.document),
			};
		},
	};
}

/**
 * Turns the query's ranges and Entry Bar flag into a Typesense `filter_by` clause. Ranges are
 * inclusive on both bounds, and a range over a field a Channel lacks excludes it — Typesense
 * drops documents missing a filtered field, the same rule the fake enforces.
 */
function filterBy(query: SearchQuery): string {
	const clauses: string[] = [];

	// Require the Entry Bar unless the query opts out with `false`, which lets flagged
	// Channels back into the results.
	if ((query.meetsEntryBar ?? true) === true) {
		clauses.push("meetsEntryBar:true");
	}

	for (const [field, range] of Object.entries(query.ranges ?? {})) {
		if (range?.min !== undefined) {
			clauses.push(`${field}:>=${range.min}`);
		}
		if (range?.max !== undefined) {
			clauses.push(`${field}:<=${range.max}`);
		}
	}

	return clauses.join(" && ");
}

/**
 * Turns the multi-field sort into Typesense's `sort_by`. Each key places missing values at
 * the favourable end of its direction — `first` for descending, `last` for ascending — so an
 * unmeasured Channel never sorts below one the index watched decline, matching the fake's
 * `+Infinity` placement exactly.
 */
function sortBy(sort: SortKey[]): string {
	return sort
		.map(({ field, direction }) => {
			const missing = direction === "desc" ? "first" : "last";
			return `${field}(missing_values: ${missing}):${direction}`;
		})
		.join(",");
}

/** Typesense pages are 1-based; the port takes a 0-based offset in whole pages. */
function pageFor(query: SearchQuery): number {
	const limit = query.limit ?? 20;
	const offset = query.offset ?? 0;
	return Math.floor(offset / limit) + 1;
}
