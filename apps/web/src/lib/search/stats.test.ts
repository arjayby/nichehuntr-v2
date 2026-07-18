import { describe, expect, it } from "vitest";

import { CHANNEL_SIGNALS, formatCount, formatSignal } from "./stats";

describe("counting things a Channel has", () => {
	it("keeps a small number exact", () => {
		expect(formatCount(300)).toBe("300");
	});

	it("shortens the big ones the way a creator reads them", () => {
		expect(formatCount(12_000)).toBe("12K");
		expect(formatCount(1_500_000)).toBe("1.5M");
		expect(formatCount(4_000_000)).toBe("4M");
	});
});

describe("showing a Signal on a row", () => {
	it("shows a Signal in the unit it is quoted in", () => {
		expect(formatSignal("momentum", 2.34).text).toBe("2.3×");
		expect(formatSignal("uploadCadencePerWeek", 5).text).toBe("5/wk");
		expect(formatSignal("channelAgeDays", 120).text).toBe("120d");
		expect(formatSignal("medianViewsPerVideo", 33_000).text).toBe("33K");
	});

	it("shows an unmeasured Signal as unmeasured, never as a zero", () => {
		// Zero says "we looked and there was nothing"; absent says "there was nothing to look
		// at". A Channel we know nothing about must not read as the worst Channel we know.
		const shown = formatSignal("momentum", undefined);

		expect(shown.text).toBe("—");
		expect(shown.title).toMatch(/not measured/i);
	});

	it("explains every Signal it shows in one sentence", () => {
		for (const signal of CHANNEL_SIGNALS) {
			expect(formatSignal(signal.field, 1).title).toMatch(/\S/);
		}
	});
});
