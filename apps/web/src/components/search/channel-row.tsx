import type { SearchDocument } from "@nichehuntr-v2/backend/convex/search/searchIndex";

import { formatCount, formatSignal, ROW_SIGNALS } from "@/lib/search/stats";

import { FormShareBars } from "./form-share";
import { FreshnessBadge } from "./freshness-badge";

/**
 * One Channel in the results.
 *
 * It shows every Signal the list can be sorted by, so a user can check the sort by eye rather
 * than take it on trust — that is what "every Signal is verifiable" means at the point of use.
 * Its two raw stats are printed as plain context, not as anything the list is ranked by.
 *
 * It takes a `lastRefreshedAt` because it takes stats: the two are not separable here. There is
 * no arrangement of this component that shows a number without saying how old it is.
 */
export function ChannelRow({
	channel,
	now,
}: {
	channel: SearchDocument;
	now?: number;
}) {
	return (
		<article className="flex flex-col gap-3 border-foreground/10 border-b p-4 last:border-b-0">
			<div className="flex items-start justify-between gap-4">
				<div className="min-w-0">
					<h3 className="truncate font-medium text-sm">
						<a
							href={`https://www.youtube.com/channel/${channel.youtubeChannelId}`}
							target="_blank"
							rel="noreferrer"
							className="hover:underline"
						>
							{channel.title}
						</a>
					</h3>
					<p className="line-clamp-2 text-muted-foreground text-xs">
						{channel.description}
					</p>
				</div>
				<FreshnessBadge lastRefreshedAt={channel.lastRefreshedAt} now={now} />
			</div>

			<p className="text-muted-foreground text-xs">
				<span className="text-foreground">
					{formatCount(channel.subscriberCount)}
				</span>{" "}
				subscribers ·{" "}
				<span className="text-foreground">
					{formatCount(channel.totalViewCount)}
				</span>{" "}
				total views
			</p>

			<ul
				aria-label="Signals"
				className="grid grid-cols-3 gap-2 sm:grid-cols-6"
			>
				{ROW_SIGNALS.map((signal) => {
					const shown = formatSignal(signal.field, channel[signal.field]);
					return (
						<li
							key={signal.field}
							className="flex flex-col"
							title={shown.title}
						>
							<span className="text-[0.7rem] text-muted-foreground">
								{signal.label}
							</span>
							<span className="font-medium text-xs tabular-nums">
								{shown.text}
							</span>
						</li>
					);
				})}
			</ul>

			<FormShareBars
				shortsUploadShare={channel.shortsUploadShare}
				shortsViewShare={channel.shortsViewShare}
			/>
		</article>
	);
}
