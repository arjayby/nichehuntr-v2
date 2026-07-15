/**
 * Growth Metrics: how many subscribers and views a Channel gained over the last 7 / 30 /
 * 90 days, derived by subtracting two Channel Snapshots and written back onto the Channel
 * so a search can filter and sort on them directly — never computed across Snapshots at
 * query time.
 *
 * A rate of change is not a fact about a Channel; it is a fact about two Snapshots
 * subtracted (see `channelSnapshots` in `schema.ts`). Growth Metrics are what tell a
 * *rising* Channel apart from one that is merely *large*: two Channels with identical
 * current stats can be opposite investments, and only their histories say which.
 *
 * Every window is `undefined` until a Snapshot old enough to anchor it exists — never
 * zero. A search that sorted an unmeasurable Channel as a zero would rank it below every
 * Channel it had actually watched decline, which is exactly backwards: an absent Growth
 * says "we have not watched this Channel long enough to say", not "this Channel did not
 * grow". This is the same rule Signals follow, and for the same reason. Storing it absent
 * rather than as a sentinel is only half the guarantee: the projection that serves search
 * (see `docs/adr/0001-external-search-engine-for-channel-search.md`) must order an absent
 * Growth as *not* the worst, or an unmeasured Channel would still sort below a declining
 * one downstream of here.
 *
 * Growth is recomputed on every Refresh alongside the Channel's Signals, so it is true
 * *as of* `lastRefreshedAt` like every other stat on the document — it does not drift on
 * its own between crawls, because neither does anything else the Channel claims.
 */
import { type Infer, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { type ChannelStats, statsOf } from "./discovery/channelStats";

const DAY = 24 * 60 * 60 * 1000;

/**
 * The windows, in days, a Channel's growth is measured over. Each becomes available on
 * its own schedule — 7-day growth once we hold a Snapshot a week old, 90-day growth once
 * we hold one a quarter old — so an index that has only just started crawling reports the
 * short windows honestly while the long ones stay unavailable.
 */
export const GROWTH_WINDOW_DAYS = { "7d": 7, "30d": 30, "90d": 90 } as const;

export const growthValidator = v.object({
	subscribersGained7d: v.optional(v.number()),
	viewsGained7d: v.optional(v.number()),
	subscribersGained30d: v.optional(v.number()),
	viewsGained30d: v.optional(v.number()),
	subscribersGained90d: v.optional(v.number()),
	viewsGained90d: v.optional(v.number()),
});

export type Growth = Infer<typeof growthValidator>;

/**
 * The Channel Snapshot anchoring each window: the most recent one at least that many days
 * old. Absent when no Snapshot reaches that far back, which is what makes the window
 * unavailable. Typed as `ChannelStats` so a Snapshot read straight from the table can be
 * handed in whole.
 *
 * Keyed by the same `7d` / `30d` / `90d` token that suffixes the stored fields, so an
 * anchor and the Growth it feeds are read off the one name.
 */
export type GrowthAnchors = {
	"7d"?: ChannelStats;
	"30d"?: ChannelStats;
	"90d"?: ChannelStats;
};

/**
 * What a stat gained between its anchor and now, or `undefined` if nothing anchors the
 * window. A loss is a negative number, not a zero and not an absence: a Channel that shed
 * subscribers grew by a negative amount, and that is a measurement we did make.
 */
function gainedSince(
	current: ChannelStats,
	anchor: ChannelStats | undefined,
): { subscribers: number | undefined; views: number | undefined } {
	if (anchor === undefined) {
		return { subscribers: undefined, views: undefined };
	}
	return {
		subscribers: current.subscriberCount - anchor.subscriberCount,
		views: current.totalViewCount - anchor.totalViewCount,
	};
}

/**
 * Subtracts each window's anchor Snapshot from the Channel's current stats. Pure: the
 * caller resolves the anchors from the Snapshot table and passes the clock in, so the
 * arithmetic can be tested at its edges directly.
 */
export function computeGrowth({
	current,
	anchors,
}: {
	current: ChannelStats;
	anchors: GrowthAnchors;
}): Growth {
	const d7 = gainedSince(current, anchors["7d"]);
	const d30 = gainedSince(current, anchors["30d"]);
	const d90 = gainedSince(current, anchors["90d"]);
	return {
		subscribersGained7d: d7.subscribers,
		viewsGained7d: d7.views,
		subscribersGained30d: d30.subscribers,
		viewsGained30d: d30.views,
		subscribersGained90d: d90.subscribers,
		viewsGained90d: d90.views,
	};
}

/**
 * The most recent Channel Snapshot at least `days` old — the reading a window of that
 * length is measured back to. `undefined` when no Snapshot reaches that far, which leaves
 * the window unavailable.
 *
 * At least `days` old, never merely nearest: growth over "the last N days" is honest only
 * against a reading from N-or-more days ago, so the number can never claim to span *less*
 * history than it has. It can span a little more — the anchor lands on the previous
 * Snapshot, so the overshoot is the gap to it, which Refresh cadence caps at about a week.
 * That is a rounding error against the 30- and 90-day windows, and proportionally largest
 * on the 7-day one, where a Channel crawled only weekly can measure growth over closer to
 * a fortnight. The window still reports growth over *at least* seven days; it never
 * reports fewer, which is the honesty that matters here.
 */
async function anchorFor(
	ctx: MutationCtx,
	channelId: Id<"channels">,
	days: number,
	now: number,
): Promise<ChannelStats | undefined> {
	const snapshot = await ctx.db
		.query("channelSnapshots")
		.withIndex("by_channel_taken_at", (q) =>
			q.eq("channelId", channelId).lte("takenAt", now - days * DAY),
		)
		.order("desc")
		.first();
	return snapshot ? statsOf(snapshot) : undefined;
}

/**
 * Resolves the anchor Snapshot for every window from the Channel's Snapshot history —
 * three targeted reads, not a scan of the window, so a hot Channel with a quarter of
 * six-hourly Snapshots is not loaded whole on every Refresh.
 */
export async function growthAnchors(
	ctx: MutationCtx,
	channelId: Id<"channels">,
	now: number,
): Promise<GrowthAnchors> {
	const [d7, d30, d90] = await Promise.all([
		anchorFor(ctx, channelId, GROWTH_WINDOW_DAYS["7d"], now),
		anchorFor(ctx, channelId, GROWTH_WINDOW_DAYS["30d"], now),
		anchorFor(ctx, channelId, GROWTH_WINDOW_DAYS["90d"], now),
	]);
	return { "7d": d7, "30d": d30, "90d": d90 };
}
