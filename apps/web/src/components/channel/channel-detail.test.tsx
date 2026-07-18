import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { aChannelDetail, aVideo, DAY, NOW } from "@/testing/channels";

import { ChannelDetailView } from "./channel-detail";

const renderDetail = (channel = aChannelDetail()) =>
	render(<ChannelDetailView channel={channel} now={NOW} />);

describe("the case a Channel detail makes", () => {
	it("names the Channel and what it is about", () => {
		renderDetail();

		expect(
			screen.getByRole("heading", { name: "Bonsai Hours" }),
		).toBeInTheDocument();
		expect(
			screen.getByText("Slow television for small trees."),
		).toBeInTheDocument();
	});

	it("links out to the Channel on YouTube", () => {
		renderDetail();

		const link = screen.getByRole("link", { name: /on youtube/i });
		expect(link).toHaveAttribute(
			"href",
			"https://www.youtube.com/channel/UC_bonsai",
		);
		expect(link).toHaveAttribute("target", "_blank");
		expect(link).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
	});

	it("shows how old the numbers are — no stat here is shown without its Freshness", () => {
		renderDetail();

		expect(screen.getByText("2 hours ago")).toBeInTheDocument();
	});

	it("brings all the Channel's Signals together", () => {
		renderDetail(
			aChannelDetail({
				momentum: 2.3,
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

	it("shows the gap between what the Channel makes and what works", () => {
		renderDetail(
			aChannelDetail({ shortsUploadShare: 0.2, shortsViewShare: 0.85 }),
		);

		const form = screen.getByRole("group", { name: /shorts/i });
		expect(within(form).getByText(/punch far above/i)).toBeInTheDocument();
	});

	it("shows an unmeasured Signal as unmeasured rather than as a zero", () => {
		renderDetail(aChannelDetail({ momentum: undefined }));

		const signals = screen.getByRole("list", { name: /signals/i });
		expect(within(signals).getByText("—")).toBeInTheDocument();
		expect(within(signals).queryByText("0×")).not.toBeInTheDocument();
	});
});

describe("the Channel's recent Videos", () => {
	it("lists each Video with its view count, publish date and Form", () => {
		renderDetail(
			aChannelDetail({
				videos: [
					aVideo({
						title: "Repotting a juniper",
						viewCount: 90_000,
						publishedAt: NOW - 3 * DAY,
						form: "longform",
					}),
				],
			}),
		);

		const videos = screen.getByRole("list", { name: /videos/i });
		const row = within(videos).getByText("Repotting a juniper").closest("li");
		expect(row).not.toBeNull();
		const video = within(row as HTMLElement);
		expect(video.getByText(/90K/)).toBeInTheDocument();
		expect(video.getByText("3 days ago")).toBeInTheDocument();
		expect(video.getByText("Long-form")).toBeInTheDocument();
	});

	it("marks the Video that broke out, and says by how far it beat the median", () => {
		renderDetail(
			aChannelDetail({
				medianViewsPerVideo: 33_000,
				videos: [
					aVideo({
						youtubeVideoId: "vid_break",
						title: "One cut, huge difference",
						viewCount: 800_000,
						viewsVsMedian: 24,
						isOutlier: true,
					}),
					aVideo({
						youtubeVideoId: "vid_plain",
						title: "Watering, again",
						viewCount: 30_000,
						viewsVsMedian: 0.9,
						isOutlier: false,
					}),
				],
			}),
		);

		const videos = screen.getByRole("list", { name: /videos/i });
		const outlier = within(videos)
			.getByText("One cut, huge difference")
			.closest("li");
		const plain = within(videos).getByText("Watering, again").closest("li");

		// The mark carries the multiple against the median — the case, not a bare badge.
		expect(
			within(outlier as HTMLElement).getByText(/24.*median/i),
		).toBeInTheDocument();
		// A Video that did not break out is not dressed up as one.
		expect(
			within(plain as HTMLElement).queryByText(/median/i),
		).not.toBeInTheDocument();
	});

	it("links each Video to itself on YouTube", () => {
		renderDetail(
			aChannelDetail({
				videos: [aVideo({ youtubeVideoId: "vid_x", title: "A video" })],
			}),
		);

		expect(screen.getByRole("link", { name: "A video" })).toHaveAttribute(
			"href",
			"https://www.youtube.com/watch?v=vid_x",
		);
	});

	it("says so plainly when a Channel has no Videos yet, rather than showing an empty list", () => {
		renderDetail(aChannelDetail({ videos: [] }));

		expect(screen.getByText(/no videos/i)).toBeInTheDocument();
	});
});

describe("what the detail says before it has an answer", () => {
	it("shows a loading state while the Channel is still being read", () => {
		render(<ChannelDetailView channel={undefined} now={NOW} />);

		expect(screen.getByText(/loading/i)).toBeInTheDocument();
	});

	it("says a Channel is not in the index rather than rendering a blank case", () => {
		render(<ChannelDetailView channel={null} now={NOW} />);

		expect(screen.getByText(/not in the index/i)).toBeInTheDocument();
	});
});
