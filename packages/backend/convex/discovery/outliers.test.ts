import { describe, expect, it } from "vitest";
import { markOutliers, OUTLIER_THRESHOLD } from "./outliers";

/** A Video reduced to the two things marking one needs: an id to key on and its views. */
const aVideo = (youtubeVideoId: string, viewCount: number) => ({
	youtubeVideoId,
	viewCount,
});

describe("marking a Channel's outlier Videos", () => {
	it("marks a Video that beats the Channel's own median by the threshold", () => {
		// Median 10k, threshold 3×: 30k is the boundary and counts, 40k clears it, 25k does not.
		const marked = markOutliers(
			[
				aVideo("floor", OUTLIER_THRESHOLD * 10_000),
				aVideo("clears", 40_000),
				aVideo("ordinary", 25_000),
			],
			10_000,
		);

		expect(marked.map((v) => [v.youtubeVideoId, v.isOutlier])).toEqual([
			["floor", true],
			["clears", true],
			["ordinary", false],
		]);
	});

	it("measures each Video against the Channel's own median, not against the others", () => {
		// The same 60k Video is an outlier on a Channel whose typical Video does 10k and an
		// ordinary one on a Channel whose typical Video does 30k. The median it is measured
		// against is the Channel's, which is the whole point of the acceptance criterion.
		const onModest = markOutliers([aVideo("v", 60_000)], 10_000);
		const onStrong = markOutliers([aVideo("v", 60_000)], 30_000);

		expect(onModest[0]?.isOutlier).toBe(true);
		expect(onStrong[0]?.isOutlier).toBe(false);
	});

	it("carries each Video's ratio against the median, so the mark is checkable by eye", () => {
		const marked = markOutliers([aVideo("v", 45_000)], 10_000);

		expect(marked[0]?.viewsVsMedian).toBe(4.5);
	});

	it("cannot call anything an outlier when the Channel has no median to measure against", () => {
		// A Channel we have no median for (no Videos crawled) has no typical Video, so nothing
		// can be said to beat it — the ratio is unknowable, never zero, and nothing is marked.
		const marked = markOutliers([aVideo("v", 500_000)], undefined);

		expect(marked[0]?.isOutlier).toBe(false);
		expect(marked[0]?.viewsVsMedian).toBeUndefined();
	});

	it("cannot divide by a median of zero", () => {
		// A Channel whose crawled Videos all did zero views has a median of zero — a ratio
		// against it is undefined, not infinite, and marks nothing.
		const marked = markOutliers([aVideo("v", 500_000)], 0);

		expect(marked[0]?.isOutlier).toBe(false);
		expect(marked[0]?.viewsVsMedian).toBeUndefined();
	});

	it("keeps the Videos in the order it was given them", () => {
		const marked = markOutliers(
			[aVideo("a", 5_000), aVideo("b", 90_000), aVideo("c", 12_000)],
			10_000,
		);

		expect(marked.map((v) => v.youtubeVideoId)).toEqual(["a", "b", "c"]);
	});

	it("preserves every other field on the Video it is handed", () => {
		const marked = markOutliers(
			[{ youtubeVideoId: "v", viewCount: 90_000, title: "One cut" }],
			10_000,
		);

		expect(marked[0]).toMatchObject({
			youtubeVideoId: "v",
			viewCount: 90_000,
			title: "One cut",
			isOutlier: true,
		});
	});
});
