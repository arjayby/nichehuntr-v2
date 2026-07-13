/**
 * The ChannelSource port: one interface over *all* outside channel data — the seed
 * vendor and YouTube alike. All Crawl Budget is spent behind this port and nowhere
 * else, so a vendor swap happens here and only here.
 */
import { type Infer, v } from "convex/values";

/** A Channel as the outside world reports it, before it enters our index. */
export const sourceChannelValidator = v.object({
  youtubeChannelId: v.string(),
  title: v.string(),
  description: v.string(),
  handle: v.optional(v.string()),
  thumbnailUrl: v.optional(v.string()),
  subscriberCount: v.number(),
  totalViewCount: v.number(),
  videoCount: v.number(),
  /** When the Channel was created on YouTube — the basis of Channel Age. */
  publishedAt: v.number(),
});

/**
 * A Video as the outside world reports it. Form is absent: it is ours to derive,
 * not the vendor's to tell us.
 */
export const sourceVideoValidator = v.object({
  youtubeVideoId: v.string(),
  title: v.string(),
  publishedAt: v.number(),
  viewCount: v.number(),
  durationSeconds: v.number(),
});

export type SourceChannel = Infer<typeof sourceChannelValidator>;
export type SourceVideo = Infer<typeof sourceVideoValidator>;

export type ChannelSource = {
  getChannel(youtubeChannelId: string): Promise<SourceChannel | null>;
  /** Most recently published Videos first. */
  listVideos(
    youtubeChannelId: string,
    options?: { limit?: number },
  ): Promise<SourceVideo[]>;
  discoverByKeyword(
    keyword: string,
    options?: { limit?: number },
  ): Promise<SourceChannel[]>;
};

let configuredSource: ChannelSource | null = null;

/**
 * Installs the ChannelSource every crawl runs through. Tests install the in-memory
 * fake here; production installs the real vendor adapter.
 */
export function setChannelSource(source: ChannelSource | null): void {
  configuredSource = source;
}

export function getChannelSource(): ChannelSource {
  if (configuredSource === null) {
    throw new Error("No ChannelSource configured");
  }
  return configuredSource;
}
