/**
 * The stats of a Channel that *move*: the only things worth measuring twice, and so
 * the only things a Channel Snapshot records. A Channel's title or handle changing is
 * not a measurement, and a Snapshot is not a version history of the document.
 */
import { type Infer, v } from "convex/values";

export const channelStatsValidator = v.object({
  subscriberCount: v.number(),
  totalViewCount: v.number(),
  videoCount: v.number(),
});

export type ChannelStats = Infer<typeof channelStatsValidator>;

/** Takes the moving stats off a Channel, whatever else it is carrying. */
export function statsOf(channel: ChannelStats): ChannelStats {
  return {
    subscriberCount: channel.subscriberCount,
    totalViewCount: channel.totalViewCount,
    videoCount: channel.videoCount,
  };
}
