import { describe, expect, it } from "vitest";
import { type ChannelStats, statsOf } from "./discovery/channelStats";
import { computeGrowth, type GrowthAnchors } from "./growth";

/** A ChannelStats with only the moving fields a Growth Metric subtracts. */
const stats = (subscriberCount: number, totalViewCount: number): ChannelStats =>
	statsOf({ subscriberCount, totalViewCount, videoCount: 0 });

describe("computeGrowth", () => {
	it("reports subscribers and views gained over each window", () => {
		const growth = computeGrowth({
			current: stats(20_000, 5_000_000),
			anchors: {
				"7d": stats(19_000, 4_900_000),
				"30d": stats(15_000, 4_000_000),
				"90d": stats(10_000, 3_000_000),
			},
		});

		expect(growth).toEqual({
			subscribersGained7d: 1_000,
			viewsGained7d: 100_000,
			subscribersGained30d: 5_000,
			viewsGained30d: 1_000_000,
			subscribersGained90d: 10_000,
			viewsGained90d: 2_000_000,
		});
	});

	it("reports a window as unavailable, never zero, when no Snapshot anchors it", () => {
		// A Channel with no reading from 30+ days ago cannot say how much it grew in 30
		// days. Unavailable is the honest answer; a zero would claim it did not grow.
		const growth = computeGrowth({
			current: stats(20_000, 5_000_000),
			anchors: { "7d": stats(19_000, 4_900_000) },
		});

		expect(growth.subscribersGained7d).toBe(1_000);
		expect(growth.subscribersGained30d).toBeUndefined();
		expect(growth.viewsGained30d).toBeUndefined();
		expect(growth.subscribersGained90d).toBeUndefined();
		expect(growth.viewsGained90d).toBeUndefined();
	});

	it("leaves unavailable Growth absent, so it never sorts below a Channel that shrank", () => {
		// A Channel that lost subscribers has genuinely negative growth. Unavailable Growth
		// must not be stored as a number at all — a sentinel zero or minus-something would
		// sort a Channel we cannot measure below one we measured and found declining.
		const shrinking = computeGrowth({
			current: stats(9_000, 3_000_000),
			anchors: { "30d": stats(12_000, 3_000_000) },
		});
		const unmeasured = computeGrowth({
			current: stats(20_000, 5_000_000),
			anchors: {},
		});

		expect(shrinking.subscribersGained30d).toBe(-3_000);
		expect(unmeasured.subscribersGained30d).toBeUndefined();
	});

	it("distinguishes two Channels with identical current stats but different histories", () => {
		// A rate of change is a fact about two Snapshots subtracted, not about the current
		// one. Two Channels sitting at the same stats today are opposite investments if one
		// climbed to get there and the other has been flat.
		const current = stats(20_000, 5_000_000);
		const climbing = computeGrowth({
			current,
			anchors: { "30d": stats(10_000, 3_000_000) },
		});
		const plateaued = computeGrowth({
			current,
			anchors: { "30d": stats(19_000, 4_950_000) },
		});

		expect(climbing.subscribersGained30d).toBe(10_000);
		expect(plateaued.subscribersGained30d).toBe(1_000);
		expect(climbing.subscribersGained30d).not.toBe(
			plateaued.subscribersGained30d,
		);
	});

	it("takes only the moving stats off its anchors, whatever else they carry", () => {
		// Anchors arrive straight off a Channel Snapshot, so the type has to accept the
		// extra fields a Snapshot carries and subtract only the ones that move.
		const anchors: GrowthAnchors = {
			"7d": stats(19_000, 4_900_000),
		};
		expect(
			computeGrowth({ current: stats(20_000, 5_000_000), anchors }),
		).toMatchObject({ subscribersGained7d: 1_000 });
	});
});
