import type {
  ChannelSource,
  SourceChannel,
  SourceVideo,
} from "../convex/discovery/channelSource";

export type FakeChannel = SourceChannel & {
  videos: SourceVideo[];
  /** Keywords this Channel is discoverable by. */
  keywords?: string[];
};

/**
 * An in-memory ChannelSource. Every test crawls through this — no test spends
 * Crawl Budget or depends on YouTube being up.
 *
 * It lives outside `convex/` on purpose: Convex bundles everything under that
 * directory except `_generated` and `*.test.ts`, and a fake vendor has no business
 * being deployed.
 */
export function createFakeChannelSource(
  seed: FakeChannel[] = [],
): ChannelSource & {
  /** Replaces a seeded Channel, so a test can simulate what a later crawl sees. */
  set(channel: FakeChannel): void;
  /** Drops a Channel, so a test can simulate one deleted on YouTube between crawls. */
  remove(youtubeChannelId: string): void;
} {
  const channels = new Map<string, FakeChannel>(
    seed.map((channel) => [channel.youtubeChannelId, channel]),
  );

  const strip = ({ videos: _v, keywords: _k, ...channel }: FakeChannel) =>
    channel;

  return {
    set(channel) {
      channels.set(channel.youtubeChannelId, channel);
    },

    remove(youtubeChannelId) {
      channels.delete(youtubeChannelId);
    },

    async getChannel(youtubeChannelId) {
      const channel = channels.get(youtubeChannelId);
      return channel ? strip(channel) : null;
    },

    async listVideos(youtubeChannelId, options) {
      const channel = channels.get(youtubeChannelId);
      if (!channel) {
        return [];
      }
      const newestFirst = [...channel.videos].sort(
        (a, b) => b.publishedAt - a.publishedAt,
      );
      return newestFirst.slice(0, options?.limit ?? newestFirst.length);
    },

    async discoverByKeyword(keyword, options) {
      const matches = [...channels.values()].filter((channel) =>
        channel.keywords?.includes(keyword),
      );
      return matches
        .slice(0, options?.limit ?? matches.length)
        .map((channel) => strip(channel));
    },
  };
}
