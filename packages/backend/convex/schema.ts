import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  sourceChannelValidator,
  sourceVideoValidator,
} from "./discovery/channelSource";
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
  })
    .index("by_youtube_channel_id", ["youtubeChannelId"])
    /** Least recently read first: the order Refresh works through the index in. */
    .index("by_last_refreshed_at", ["lastRefreshedAt"]),

  /**
   * A Channel's stats at one moment, written by every Refresh and never rewritten.
   * Append-only: a rate of change is not a fact about a Channel, it is a fact about
   * two Snapshots subtracted, so an overwritten Snapshot is a measurement destroyed —
   * and history cannot be backfilled.
   *
   * Only the stats that *move* are recorded. A Channel's title or handle changing is
   * not a measurement, and a Snapshot is not a version history of the document.
   *
   * Never read on a search path. Snapshots are read only by the job that computes
   * Growth Metrics, which writes its results back onto the Channel — which is why a
   * search can stay a single read of a single flat document.
   */
  channelSnapshots: defineTable({
    channelId: v.id("channels"),
    subscriberCount: v.number(),
    totalViewCount: v.number(),
    videoCount: v.number(),
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
