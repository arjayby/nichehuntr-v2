import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { aChannel, DAY, HOUR, NOW } from "@/testing/channels";

import { ChannelRow } from "./channel-row";

const renderRow = (channel = aChannel()) =>
	render(<ChannelRow channel={channel} now={NOW} />);

describe("what a row says about a Channel", () => {
	it("names the Channel and what it is about", () => {
		renderRow();

		expect(screen.getByText("Bonsai Hours")).toBeInTheDocument();
		expect(
			screen.getByText("Slow television for small trees."),
		).toBeInTheDocument();
	});

	it("opens the Channel's detail, where the case for cloning it is made", () => {
		// The row is the door into the Channel — its Signals, its Videos, its outliers — not a
		// shortcut out to YouTube. That link out lives on the detail, one step in.
		renderRow();

		expect(screen.getByRole("link", { name: "Bonsai Hours" })).toHaveAttribute(
			"href",
			"/channels/UC_bonsai",
		);
	});

	it("shows the raw stats that say how hard it would be to compete", () => {
		renderRow();

		expect(screen.getByText(/12K/)).toBeInTheDocument();
		expect(screen.getByText(/4M/)).toBeInTheDocument();
	});

	it("shows every Signal it can be sorted by, so the sort is checkable by eye", () => {
		renderRow(
			aChannel({
				momentum: 2.34,
				viewsPerSubscriber: 333,
				medianViewsPerVideo: 33_000,
				outlierRatio: 4.1,
				uploadCadencePerWeek: 2,
				channelAgeDays: 400,
			}),
		);

		const signals = screen.getByRole("list", { name: /signals/i });
		expect(within(signals).getByText("2.3×")).toBeInTheDocument();
		expect(within(signals).getByText("333")).toBeInTheDocument();
		expect(within(signals).getByText("33K")).toBeInTheDocument();
		expect(within(signals).getByText("4.1×")).toBeInTheDocument();
		expect(within(signals).getByText("2/wk")).toBeInTheDocument();
		expect(within(signals).getByText("400d")).toBeInTheDocument();
	});

	it("shows an unmeasured Signal as unmeasured rather than as a zero", () => {
		// Every other Signal is measured here, so the dash can only be Momentum's.
		renderRow(
			aChannel({
				momentum: undefined,
				viewsPerSubscriber: 333,
				medianViewsPerVideo: 33_000,
				outlierRatio: 4.1,
			}),
		);

		const signals = screen.getByRole("list", { name: /signals/i });
		expect(within(signals).getByText("—")).toBeInTheDocument();
		expect(within(signals).queryByText("0×")).not.toBeInTheDocument();
	});
});

describe("Freshness on a row", () => {
	it("says when we last read the Channel", () => {
		// Every row, always: Refresh is tiered, so Freshness is uneven across the index, and a
		// stat shown without it is a claim we cannot support.
		renderRow();

		expect(screen.getByText("2 hours ago")).toBeInTheDocument();
	});

	it("marks a stale Channel as stale rather than presenting it as current", () => {
		renderRow(aChannel({ lastRefreshedAt: NOW - 21 * DAY }));

		const freshness = screen.getByText("21 days ago");
		expect(freshness).toBeInTheDocument();
		expect(freshness.closest("[data-tone]")).toHaveAttribute(
			"data-tone",
			"stale",
		);
	});

	it("marks a just-crawled Channel fresh", () => {
		renderRow(aChannel({ lastRefreshedAt: NOW - 1 * HOUR }));

		expect(
			screen.getByText("1 hour ago").closest("[data-tone]"),
		).toHaveAttribute("data-tone", "fresh");
	});
});

describe("the gap between what a Channel makes and what works", () => {
	it("shows both shares, and does not let a 90/10 Channel read as a Shorts channel", () => {
		renderRow(aChannel({ shortsUploadShare: 0.9, shortsViewShare: 0.1 }));

		const form = screen.getByRole("group", { name: /shorts/i });
		expect(within(form).getByText("90%")).toBeInTheDocument();
		expect(within(form).getByText("10%")).toBeInTheDocument();
		// The gap is not left for the user to compute: the row says what it means.
		expect(
			within(form).getByText(/views come from long-form/i),
		).toBeInTheDocument();
	});

	it("says when a Channel's Shorts are doing the work", () => {
		renderRow(aChannel({ shortsUploadShare: 0.2, shortsViewShare: 0.85 }));

		const form = screen.getByRole("group", { name: /shorts/i });
		expect(within(form).getByText(/punch far above/i)).toBeInTheDocument();
	});

	it("does not editorialise when what it makes is what works", () => {
		renderRow(aChannel({ shortsUploadShare: 0.8, shortsViewShare: 0.75 }));

		const form = screen.getByRole("group", { name: /shorts/i });
		expect(within(form).getByText("80%")).toBeInTheDocument();
		expect(within(form).getByText("75%")).toBeInTheDocument();
		expect(within(form).queryByText(/long-form/i)).not.toBeInTheDocument();
	});

	it("says the Form is unmeasured rather than showing it as 0% Shorts", () => {
		renderRow(
			aChannel({ shortsUploadShare: undefined, shortsViewShare: undefined }),
		);

		const form = screen.getByRole("group", { name: /shorts/i });
		expect(within(form).getByText(/not measured/i)).toBeInTheDocument();
		expect(within(form).queryByText("0%")).not.toBeInTheDocument();
	});
});
