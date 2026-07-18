import { describe, expect, it } from "vitest";

import { describeVideo } from "./video";

const NOW = Date.UTC(2026, 6, 16, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

const aVideo = (overrides = {}) => ({
	youtubeVideoId: "vid_1",
	title: "One cut, huge difference",
	publishedAt: NOW - 2 * DAY,
	viewCount: 800_000,
	form: "short" as const,
	viewsVsMedian: 5,
	isOutlier: true,
	...overrides,
});

describe("a Video on the Channel detail", () => {
	it("prints the view count the way a creator reads it", () => {
		expect(describeVideo(aVideo({ viewCount: 800_000 }), NOW).views).toBe(
			"800K",
		);
	});

	it("names the Form in words rather than a stored token", () => {
		expect(describeVideo(aVideo({ form: "short" }), NOW).formLabel).toBe(
			"Short",
		);
		expect(describeVideo(aVideo({ form: "longform" }), NOW).formLabel).toBe(
			"Long-form",
		);
	});

	it("says when it was published, in the largest unit that still carries information", () => {
		expect(
			describeVideo(aVideo({ publishedAt: NOW - 2 * DAY }), NOW).published,
		).toBe("2 days ago");
	});

	it("spells out an outlier by how far it beat the Channel's median", () => {
		// The mark is the case: "this specific idea did 5× the typical Video here."
		const shown = describeVideo(
			aVideo({ isOutlier: true, viewsVsMedian: 5 }),
			NOW,
		);

		expect(shown.isOutlier).toBe(true);
		expect(shown.outlierLabel).toBe("5.0× median");
	});

	it("says nothing about an outlier for a Video that did not break out", () => {
		const shown = describeVideo(
			aVideo({ isOutlier: false, viewsVsMedian: 1.2 }),
			NOW,
		);

		expect(shown.isOutlier).toBe(false);
		expect(shown.outlierLabel).toBeUndefined();
	});
});
