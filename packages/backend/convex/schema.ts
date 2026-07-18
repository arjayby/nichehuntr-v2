import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
	sourceChannelValidator,
	sourceVideoValidator,
} from "./discovery/channelSource";
import { channelStatsValidator } from "./discovery/channelStats";
import { formValidator } from "./discovery/form";
import { signalsValidator } from "./discovery/signals";
import { growthValidator } from "./growth";

export default defineSchema({
	/**
	 * A Channel as it exists in our index: flat and self-contained, so a search never
	 * has to compute across other documents. Its stats are always *as of*
	 * `lastRefreshedAt` — a cached belief about YouTube, never live truth.
	 *
	 * Its Signals are computed at ingest and stored here, so a search sorts on a number
	 * already on the Channel and never computes across its Videos. Raw subscriber and
	 * total-view counts sit beside them as plain stats: they are filters, never Signals.
	 *
	 * A Channel has no Form — it has two Form Shares, kept separate. There is no
	 * `shorts | longform | mixed` verdict, because any threshold that produced one would
	 * destroy the gap between what a Channel makes and what actually works for it.
	 */
	channels: defineTable({
		...sourceChannelValidator.fields,
		...signalsValidator.fields,
		/**
		 * How much this Channel has grown over the last 7 / 30 / 90 days, subtracted from
		 * its Channel Snapshots and denormalised onto it so a search can filter and sort
		 * without computing across other documents. Each window is absent until a Snapshot
		 * old enough to anchor it exists — unavailable, never zero, so an unmeasurable
		 * Channel never sorts below one measured and found declining. See `growth.ts`.
		 */
		...growthValidator.fields,
		/** When we last read this Channel from a ChannelSource — its Freshness. */
		lastRefreshedAt: v.number(),
		/**
		 * Whether the Channel still clears the Entry Bar — its Entry Bar status. A Channel
		 * that goes quiet is flagged `false` and drops out of the index users search; the
		 * row stays so its Channel Snapshot history survives the dip, because history
		 * cannot be backfilled and a Channel that recovers must not come back amnesiac.
		 */
		meetsEntryBar: v.boolean(),
		/**
		 * When Refresh last *tried* to read it, which is not the same thing: a crawl that
		 * failed spent Crawl Budget without earning any Freshness.
		 *
		 * Nothing queues on this — `refreshDueAt` does. It is kept because the gap between
		 * the two dates is the only evidence a Channel is being crawled and *failing*: a
		 * Channel we tried an hour ago and last read three weeks ago is one YouTube has
		 * deleted, and without this field it is indistinguishable from one we simply never
		 * got to.
		 */
		lastRefreshAttemptedAt: v.optional(v.number()),
		/**
		 * How closely this Channel is watched, from 0 to 1 — a function of its Momentum,
		 * the demand for it, and its volatility. Stored rather than computed at read time
		 * so that it is *inspectable*: when the index is stale where a user is looking, the
		 * answer to "why was this Channel not crawled" has to be a number we can read off
		 * the Channel.
		 */
		refreshPriority: v.optional(v.number()),
		/**
		 * When this Channel next comes due — its priority, made spendable.
		 *
		 * This, and not `refreshPriority`, is what Refresh queues on. A priority sorted
		 * directly would starve every dull Channel forever, and a dull Channel still has to
		 * be crawled eventually: it is the only way we would ever learn it had stopped
		 * being dull, or gone quiet enough to age out. A deadline (last attempt + the
		 * interval its priority earned) gives the same ordering to a hot Channel — it comes
		 * due four times as often — while a cold one still reaches the head of the queue by
		 * waiting.
		 *
		 * Absent on a Channel indexed before priority existed, and absent sorts first,
		 * which is right: we have no record of ever having promised to read it.
		 */
		refreshDueAt: v.optional(v.number()),
		/**
		 * How much its stats move between Channel Snapshots. Absent until it has two — a
		 * Channel measured once has not been seen to sit still.
		 */
		volatility: v.optional(v.number()),
		/**
		 * How many saved Niches this Channel appears in: the demand for it. Absent means
		 * nobody has saved a Niche that matches it, and so nobody is waiting on its
		 * Freshness. Maintained by Niches, not by any crawl.
		 */
		demand: v.optional(v.number()),
	})
		.index("by_youtube_channel_id", ["youtubeChannelId"])
		/** Soonest due first: the order Refresh spends the day's Crawl Budget in. */
		.index("by_refresh_due_at", ["refreshDueAt"]),

	/**
	 * A Channel's stats at one moment, appended by every Refresh and never rewritten.
	 *
	 * Append-only, because a rate of change is not a fact about a Channel — it is a fact
	 * about two Snapshots subtracted. An overwritten Snapshot is a measurement destroyed,
	 * and a measurement not taken cannot be taken later: history cannot be backfilled.
	 * That is the whole reason this table exists before there is a UI to read it.
	 *
	 * Never read on a search path. Snapshots are read only by the job that computes
	 * Growth Metrics, which writes its results back onto the Channel — which is why a
	 * search can stay a single read of a single flat document.
	 */
	channelSnapshots: defineTable({
		channelId: v.id("channels"),
		...channelStatsValidator.fields,
		/** When the Channel was read — equal to the Channel's Freshness at that Refresh. */
		takenAt: v.number(),
	}).index("by_channel_taken_at", ["channelId", "takenAt"]),

	/**
	 * One row per day: what that day's Crawl Budget was, what we spent of it, and how
	 * many Refresh runs it left short.
	 *
	 * Crawl Budget is the binding constraint the whole product operates under — index
	 * size, Freshness and Coverage are all functions of it — so its consumption is a
	 * domain fact worth storing, not a metric to bolt on later. A day we ran out is a day
	 * some Channel's stats are older than we promised, and this table is where that shows
	 * up first.
	 */
	crawlBudget: defineTable({
		/** The UTC day being billed, `YYYY-MM-DD`. */
		day: v.string(),
		/** What the quota was *that day*, so a later change to it cannot rewrite history. */
		budget: v.number(),
		/** Crawls paid for: a crawl is spent when we decide to try it, not when it works. */
		spent: v.number(),
		/** Refresh runs that came up short with Channels still due — deferred, never dropped. */
		exhaustedRuns: v.number(),
	}).index("by_day", ["day"]),

	/**
	 * Every ingested Video for every indexed Channel. Not user-searchable in this
	 * release: it is the infrastructure Channel Signals are computed from.
	 */
	videos: defineTable({
		...sourceVideoValidator.fields,
		channelId: v.id("channels"),
		form: formValidator,
	})
		.index("by_youtube_video_id", ["youtubeVideoId"])
		/**
		 * A Channel's Videos, newest last — read newest-first with `.order("desc")`. Keyed on
		 * `publishedAt` as well as the Channel so the recent Videos everything downstream wants
		 * (a rebuild's projection, a detail view's list) come back already ordered and, crucially,
		 * *bounded*: a Channel accumulates a Video row per upload across every Refresh and none are
		 * deleted, so a plain `by_channel` read grows without limit. Taking the most recent
		 * `RECENT_VIDEO_LIMIT` off this index reads only what it returns.
		 */
		.index("by_channel_published_at", ["channelId", "publishedAt"]),
});
