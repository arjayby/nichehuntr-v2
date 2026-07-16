import { describe, expect, it } from "vitest";

import { describeFormShare } from "./formShare";

describe("a Channel whose Shorts are not its business", () => {
	it("does not let 90% Shorts by upload read as a Shorts channel when 10% of views agree", () => {
		// The case the product exists to not get wrong: this Channel makes almost nothing but
		// Shorts, and almost none of its views come from them. A creator cloning its *format*
		// would be cloning the 10%.
		const shares = describeFormShare({
			shortsUploadShare: 0.9,
			shortsViewShare: 0.1,
		});

		expect(shares.measured).toBe(true);
		expect(shares.gapPoints).toBe(80);
		expect(shares.divergence).toBe("shorts-do-not-work");
		expect(shares.note).toMatch(/long-form/i);
	});

	it("says the Shorts are doing the work when a few of them earn most views", () => {
		const shares = describeFormShare({
			shortsUploadShare: 0.2,
			shortsViewShare: 0.85,
		});

		expect(shares.divergence).toBe("shorts-outperform");
		expect(shares.note).toMatch(/shorts/i);
	});

	it("stays quiet when what a Channel makes is what works for it", () => {
		const shares = describeFormShare({
			shortsUploadShare: 0.8,
			shortsViewShare: 0.75,
		});

		expect(shares.divergence).toBe("aligned");
		expect(shares.note).toBeUndefined();
	});
});

describe("showing both shares", () => {
	it("shows each share as a percentage a user can read", () => {
		const shares = describeFormShare({
			shortsUploadShare: 0.9,
			shortsViewShare: 0.1,
		});

		expect(shares.upload?.label).toBe("90%");
		expect(shares.view?.label).toBe("10%");
	});

	it("rounds a share to a whole percent without rounding it to a lie", () => {
		// 0.996 is not 100%: a Channel that posts one long-form video in 250 is not a pure
		// Shorts channel, and must not be shown as one. Nor is 0.004 "0%" — some of its views
		// do come from Shorts, and "none" is a claim a rounding step may not invent.
		const shares = describeFormShare({
			shortsUploadShare: 0.996,
			shortsViewShare: 0.004,
		});

		expect(shares.upload?.label).toBe("99%");
		expect(shares.view?.label).toBe("<1%");
	});

	it("shows a genuine zero as zero", () => {
		// A Channel that really did upload no Shorts recently is a 0%, not a "<1%".
		const shares = describeFormShare({
			shortsUploadShare: 0,
			shortsViewShare: 0,
		});

		expect(shares.upload?.label).toBe("0%");
	});
});

describe("a Channel we cannot measure the Form of", () => {
	it("says so rather than showing a zero", () => {
		// A Channel with no recent uploads has no Form Share — not a Form Share of zero. Showing
		// 0% would say "it makes no Shorts", which is a claim about a Channel we have not seen
		// upload anything at all.
		const shares = describeFormShare({
			shortsUploadShare: undefined,
			shortsViewShare: undefined,
		});

		expect(shares.measured).toBe(false);
		expect(shares.upload).toBeUndefined();
		expect(shares.gapPoints).toBeUndefined();
		expect(shares.divergence).toBe("unmeasured");
	});

	it("draws no gap from one share alone", () => {
		const shares = describeFormShare({
			shortsUploadShare: 0.9,
			shortsViewShare: undefined,
		});

		expect(shares.upload?.label).toBe("90%");
		expect(shares.view).toBeUndefined();
		expect(shares.gapPoints).toBeUndefined();
		expect(shares.divergence).toBe("unmeasured");
	});
});
