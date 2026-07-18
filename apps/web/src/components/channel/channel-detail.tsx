import type {
	ChannelDetail,
	ChannelDetailVideo,
} from "@nichehuntr-v2/backend/convex/channels/detail";

import { describeVideo } from "@/lib/channel/video";
import { formatCount } from "@/lib/search/stats";

import { FormShareBars } from "../search/form-share";
import { FreshnessBadge } from "../search/freshness-badge";
import { SignalGrid } from "../search/signal-grid";

/**
 * A Channel opened in full: the case for (or against) cloning it. Every Signal on the one
 * Channel, its recent Videos with the numbers the case rests on, and — marked — the Videos that
 * broke out against the Channel's *own* median, which is the specific idea that just worked.
 *
 * Presentational and complete: it takes the Channel the detail query returns and a clock, and
 * knows nothing about how it was fetched — the route above it does that. Loading and not-found
 * are states it renders rather than the route's to guard, because "we are still reading this
 * Channel" and "we hold nothing on this Channel" are two different things to say to a user, and
 * the second is not a blank screen.
 *
 * Its numbers travel with their Freshness for the same reason a result row's do: Refresh is
 * tiered, so a stat shown without how old it is is a claim we cannot support.
 */
export function ChannelDetailView({
	channel,
	now,
}: {
	channel: ChannelDetail | null | undefined;
	/** The clock, for Freshness and publish dates. Tests pass one; the app defaults to now. */
	now?: number;
}) {
	if (channel === undefined) {
		return (
			<div className="p-8 text-center text-muted-foreground text-sm">
				Loading Channel…
			</div>
		);
	}

	if (channel === null) {
		return (
			<div className="p-8 text-center text-muted-foreground text-sm">
				This Channel is not in the index — we hold nothing on it.
			</div>
		);
	}

	const youtubeUrl = `https://www.youtube.com/channel/${channel.youtubeChannelId}`;

	return (
		<div className="mx-auto flex w-full max-w-3xl flex-col gap-6 overflow-y-auto p-4">
			<header className="flex flex-col gap-2">
				<div className="flex items-start justify-between gap-4">
					<div className="min-w-0">
						<h1 className="font-semibold text-lg">{channel.title}</h1>
						{channel.handle ? (
							<p className="text-muted-foreground text-xs">{channel.handle}</p>
						) : null}
					</div>
					<FreshnessBadge lastRefreshedAt={channel.lastRefreshedAt} now={now} />
				</div>

				<p className="text-muted-foreground text-sm">{channel.description}</p>

				{/* A Channel that has fallen below the Entry Bar still has a detail worth reading —
				    but a user must not mistake a Channel that has dropped out of the searchable
				    index for one that is currently in it. */}
				{channel.meetsEntryBar ? null : (
					<p className="text-amber-500 text-xs">
						This Channel has dropped below the Entry Bar and no longer appears
						in search. Its stats and history are kept in case it recovers.
					</p>
				)}

				<div className="flex flex-wrap items-center gap-3 text-xs">
					<span className="text-muted-foreground">
						<span className="text-foreground">
							{formatCount(channel.subscriberCount)}
						</span>{" "}
						subscribers ·{" "}
						<span className="text-foreground">
							{formatCount(channel.totalViewCount)}
						</span>{" "}
						total views
					</span>
					<a
						href={youtubeUrl}
						target="_blank"
						rel="noreferrer"
						className="text-foreground underline hover:no-underline"
					>
						Open on YouTube ↗
					</a>
				</div>
			</header>

			<section className="flex flex-col gap-3">
				<h2 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
					Signals
				</h2>
				<SignalGrid
					signals={channel}
					className="gap-3"
					valueClassName="text-sm"
				/>
				<FormShareBars
					shortsUploadShare={channel.shortsUploadShare}
					shortsViewShare={channel.shortsViewShare}
				/>
			</section>

			<section className="flex flex-col gap-3">
				<h2 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
					Recent Videos
				</h2>
				{channel.videos.length === 0 ? (
					<p className="text-muted-foreground text-xs">
						No Videos yet — we have not crawled any for this Channel.
					</p>
				) : (
					<ul aria-label="Recent Videos" className="flex flex-col">
						{channel.videos.map((video) => (
							<VideoRow key={video.youtubeVideoId} video={video} now={now} />
						))}
					</ul>
				)}
			</section>
		</div>
	);
}

/**
 * One recent Video: its title (out to the Video on YouTube), its view count, when it went up,
 * and its Form. An outlier carries the multiple it beat the Channel's median by — the mark is
 * the whole point of the screen, so it says *how far* the idea printed, not merely that it did.
 */
function VideoRow({ video, now }: { video: ChannelDetailVideo; now?: number }) {
	const shown = describeVideo(video, now);

	return (
		<li className="flex items-baseline justify-between gap-4 border-foreground/10 border-b py-2 last:border-b-0">
			<div className="flex min-w-0 flex-col">
				<a
					href={`https://www.youtube.com/watch?v=${video.youtubeVideoId}`}
					target="_blank"
					rel="noreferrer"
					className="truncate text-sm hover:underline"
				>
					{video.title}
				</a>
				<div className="flex items-center gap-2 text-[0.7rem] text-muted-foreground">
					<span>{shown.formLabel}</span>
					<span>·</span>
					<time>{shown.published}</time>
					{shown.outlierLabel ? (
						<span className="font-medium text-emerald-500">
							Outlier — {shown.outlierLabel}
						</span>
					) : null}
				</div>
			</div>
			<span className="shrink-0 font-medium text-sm tabular-nums">
				{shown.views}
			</span>
		</li>
	);
}
