import { cn } from "@nichehuntr-v2/ui/lib/utils";

import { describeFreshness, type FreshnessTone } from "@/lib/search/freshness";

/**
 * How long ago we last read this Channel, on every row that shows its stats.
 *
 * There is no prop to hide this and no variant without it. Refresh is tiered, so Freshness is
 * uneven across the index, and a stat presented without it is a claim we cannot support — so the
 * component that shows the stats takes a Freshness, not an option to show one.
 */
const TONE_STYLES: Record<FreshnessTone, string> = {
	fresh: "text-muted-foreground",
	aging: "text-amber-500",
	stale: "text-destructive",
};

const TONE_LABELS: Record<FreshnessTone, string> = {
	fresh: "Last read",
	aging: "Last read",
	// Named, not merely coloured: colour is not a claim a screen reader can read, and "stale"
	// is the whole point of showing this.
	stale: "Stale — last read",
};

export function FreshnessBadge({
	lastRefreshedAt,
	now,
	className,
}: {
	lastRefreshedAt: number;
	now?: number;
	className?: string;
}) {
	const { label, tone, title } = describeFreshness(lastRefreshedAt, now);

	return (
		<span
			data-tone={tone}
			title={title}
			className={cn(
				"inline-flex items-center gap-1 whitespace-nowrap text-[0.7rem]",
				TONE_STYLES[tone],
				className,
			)}
		>
			<span className="text-muted-foreground">{TONE_LABELS[tone]}</span>
			<time dateTime={new Date(lastRefreshedAt).toISOString()}>{label}</time>
		</span>
	);
}
