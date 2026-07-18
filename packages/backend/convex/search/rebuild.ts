/**
 * Rebuilding the search projection from Convex. The projection is derived data; Convex is
 * the system of record, so the engine's contents must be reconstructable from it at any time
 * — after an engine is wiped, migrated, or stood up empty for the first time (see
 * `docs/adr/0001-external-search-engine-for-channel-search.md`).
 *
 * A rebuild projects *every* stored Channel, flagged ones included, exactly as the
 * incremental sync on each crawl does — so a freshly rebuilt index and one kept current by
 * Refresh hold the same documents, and search behaves the same against either. It reproduces
 * each Channel's searchable text from Convex: the Channel's own words, plus the titles of its
 * most recent Videos, the same recent set a crawl projects.
 */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction, internalQuery } from "../_generated/server";
import { RECENT_VIDEO_LIMIT } from "../ingestion";
import {
	getSearchIndex,
	projectChannel,
	type SearchDocument,
} from "./searchIndex";

/**
 * How many Channels one rebuild query projects at a time. A rebuild sweeps the whole
 * `channels` table, which a single query cannot read in one go, so it is paged: each page is
 * projected in a query and handed to the action to sync.
 */
const REBUILD_BATCH = 200;

/**
 * Projects one page of Channels. Reads live in the query — the Channel and its recent Videos
 * — while the transport to the engine stays in the action, the one place allowed to reach
 * outside Convex.
 */
export const projectionBatch = internalQuery({
	args: {
		cursor: v.union(v.string(), v.null()),
		batchSize: v.optional(v.number()),
	},
	handler: async (ctx, { cursor, batchSize }) => {
		const page = await ctx.db
			.query("channels")
			.paginate({ cursor, numItems: batchSize ?? REBUILD_BATCH });

		const documents: SearchDocument[] = [];
		for (const channel of page.page) {
			// The most recent Videos, newest first, capped at the crawl's own limit — the same
			// set a crawl would have projected, so a rebuilt document matches the incremental one
			// rather than carrying every Video the Channel ever had. Bounded by the index rather
			// than collected whole and sliced: a Channel keeps a Video row per upload forever, so
			// a full collect grows without limit as the index ages.
			const recentVideos = await ctx.db
				.query("videos")
				.withIndex("by_channel_published_at", (q) =>
					q.eq("channelId", channel._id),
				)
				.order("desc")
				.take(RECENT_VIDEO_LIMIT);
			const recentTitles = recentVideos.map((video) => video.title);
			documents.push(projectChannel(channel, recentTitles));
		}

		return {
			documents,
			continueCursor: page.continueCursor,
			isDone: page.isDone,
		};
	},
});

/**
 * Rebuilds the whole projection from Convex, page by page, into whatever SearchIndex is
 * installed. Returns how many Channels it projected.
 *
 * It only ever *writes* documents. Standing the engine up empty first — dropping and
 * recreating its collection — is the engine adapter's business, not this port's (for Typesense
 * that is `recreateChannelsCollection` in `typesense.ts`, run once before this): from an empty
 * index, projecting every stored Channel is a complete rebuild.
 */
export const rebuildProjection = internalAction({
	args: {},
	handler: async (ctx) => {
		const index = getSearchIndex();
		let cursor: string | null = null;
		let projected = 0;

		for (;;) {
			// Annotated to break the self-reference: this action calls a query in its own
			// module, so the inferred return type would fold back through the generated API
			// types onto itself.
			const {
				documents,
				continueCursor,
				isDone,
			}: {
				documents: SearchDocument[];
				continueCursor: string;
				isDone: boolean;
			} = await ctx.runQuery(internal.search.rebuild.projectionBatch, {
				cursor,
			});
			if (documents.length > 0) {
				await index.upsert(documents);
				projected += documents.length;
			}
			if (isDone) {
				break;
			}
			cursor = continueCursor;
		}

		return { projected };
	},
});
