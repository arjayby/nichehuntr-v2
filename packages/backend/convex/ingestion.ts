import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation } from "./_generated/server";
import {
  getChannelSource,
  sourceChannelValidator,
  sourceVideoValidator,
} from "./discovery/channelSource";
import { deriveForm } from "./discovery/form";
import { computeSignals } from "./discovery/signals";

/** How many recent Videos one crawl of a Channel reads. */
const RECENT_VIDEO_LIMIT = 50;

/**
 * Reads a Channel and its recent Videos from the ChannelSource and stores them.
 *
 * Internal: this spends Crawl Budget, so it is reachable only from our own jobs,
 * never from a client.
 */
export const ingestChannel = internalAction({
  args: {
    youtubeChannelId: v.string(),
    videoLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const source = getChannelSource();

    const channel = await source.getChannel(args.youtubeChannelId);
    if (channel === null) {
      throw new Error(`ChannelSource has no Channel ${args.youtubeChannelId}`);
    }
    const videos = await source.listVideos(args.youtubeChannelId, {
      limit: args.videoLimit ?? RECENT_VIDEO_LIMIT,
    });

    return await ctx.runMutation(internal.ingestion.storeChannel, {
      channel,
      videos,
    });
  },
});

/**
 * Upserts a crawled Channel and its Videos. Keyed on YouTube's IDs so that
 * re-ingesting a Channel updates our beliefs about it rather than duplicating it.
 *
 * The Channel's Signals are computed here, from this one crawl, and stored on the
 * Channel — so a search reads a number off the Channel and never computes across its
 * Videos.
 */
export const storeChannel = internalMutation({
  args: {
    channel: sourceChannelValidator,
    videos: v.array(sourceVideoValidator),
  },
  handler: async (ctx, { channel, videos }) => {
    const now = Date.now();
    const crawled = videos.map((video) => ({
      ...video,
      form: deriveForm(video.durationSeconds),
    }));

    const existing = await ctx.db
      .query("channels")
      .withIndex("by_youtube_channel_id", (q) =>
        q.eq("youtubeChannelId", channel.youtubeChannelId),
      )
      .unique();

    const channelFields = {
      ...channel,
      ...computeSignals({ channel, videos: crawled, now }),
      lastRefreshedAt: now,
    };
    let channelId: Id<"channels">;
    if (existing === null) {
      channelId = await ctx.db.insert("channels", channelFields);
    } else {
      channelId = existing._id;
      // A Signal this crawl could not compute is patched away rather than left
      // behind: an absent Momentum is honest, a stale one is a lie.
      await ctx.db.patch(channelId, channelFields);
    }

    for (const video of crawled) {
      const existingVideo = await ctx.db
        .query("videos")
        .withIndex("by_youtube_video_id", (q) =>
          q.eq("youtubeVideoId", video.youtubeVideoId),
        )
        .unique();

      const videoFields = { ...video, channelId };
      if (existingVideo === null) {
        await ctx.db.insert("videos", videoFields);
      } else {
        await ctx.db.patch(existingVideo._id, videoFields);
      }
    }

    return { channelId, videosIngested: crawled.length };
  },
});
