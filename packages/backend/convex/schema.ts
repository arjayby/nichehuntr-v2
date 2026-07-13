import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  sourceChannelValidator,
  sourceVideoValidator,
} from "./discovery/channelSource";
import { formValidator } from "./discovery/form";

export default defineSchema({
  /**
   * A Channel as it exists in our index: flat and self-contained, so a search never
   * has to compute across other documents. Its stats are always *as of*
   * `lastRefreshedAt` — a cached belief about YouTube, never live truth.
   *
   * A Channel has no Form. It gets Form Shares (ratios) once Signals land.
   */
  channels: defineTable({
    ...sourceChannelValidator.fields,
    /** When we last read this Channel from a ChannelSource — its Freshness. */
    lastRefreshedAt: v.number(),
  }).index("by_youtube_channel_id", ["youtubeChannelId"]),

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
