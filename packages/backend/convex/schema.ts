import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  sourceChannelValidator,
  sourceVideoValidator,
} from "./discovery/channelSource";
import { channelStatsValidator } from "./discovery/channelStats";
import { formValidator } from "./discovery/form";
import { signalsValidator } from "./discovery/signals";

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
     * failed spent Crawl Budget without earning any Freshness. Refresh queues on this,
     * so a Channel deleted on YouTube cannot sit at the head of the queue forever
     * being retried ahead of Channels we can actually read.
     *
     * Absent on a Channel indexed before we tracked attempts — and absent sorts first,
     * which is right: we have no record of ever having tried.
     */
    lastRefreshAttemptedAt: v.optional(v.number()),
  })
    .index("by_youtube_channel_id", ["youtubeChannelId"])
    /** Least recently *attempted* first: the order Refresh spends its budget in. */
    .index("by_last_refresh_attempted_at", ["lastRefreshAttemptedAt"]),

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
   * Every ingested Video for every indexed Channel. Not user-searchable in this
   * release: it is the infrastructure Channel Signals are computed from.
   */
  videos: defineTable({
    ...sourceVideoValidator.fields,
    channelId: v.id("channels"),
    form: formValidator,
  })
    .index("by_youtube_video_id", ["youtubeVideoId"])
    .index("by_channel", ["channelId"]),
});
