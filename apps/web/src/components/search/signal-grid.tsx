import { cn } from "@nichehuntr-v2/ui/lib/utils";

import type { SortField } from "@/lib/search/criteria";
import { CHANNEL_SIGNALS, formatSignal } from "@/lib/search/stats";

/**
 * A Channel's Signals as a grid of labelled numbers — the same set, in the same order, on a
 * search result row and on a Channel's detail. Shared so the two cannot drift: a row shows these
 * to let a user check the sort by eye, and the detail shows the very same numbers in full, so
 * they have to *be* the same numbers.
 *
 * Each cell carries the Signal's one sentence as its `title`, and an absent Signal prints an em
 * dash rather than a zero — the distinction `formatSignal` keeps and this grid must not undo.
 *
 * It reads the numbers off whatever it is handed as long as that thing carries the Signals; both
 * a `SearchDocument` and a `ChannelDetail` do, which is exactly why the grid belongs to neither.
 */
export function SignalGrid({
	signals,
	className,
	valueClassName = "text-xs",
}: {
	signals: Partial<Record<SortField, number>>;
	/** Extra classes for the grid — the caller sets its own gap. */
	className?: string;
	/** The size of the number, which a detail sets larger than a row. */
	valueClassName?: string;
}) {
	return (
		<ul
			aria-label="Signals"
			className={cn("grid grid-cols-3 sm:grid-cols-6", className)}
		>
			{CHANNEL_SIGNALS.map((signal) => {
				const shown = formatSignal(signal.field, signals[signal.field]);
				return (
					<li key={signal.field} className="flex flex-col" title={shown.title}>
						<span className="text-[0.7rem] text-muted-foreground">
							{signal.label}
						</span>
						<span className={cn("font-medium tabular-nums", valueClassName)}>
							{shown.text}
						</span>
					</li>
				);
			})}
		</ul>
	);
}
