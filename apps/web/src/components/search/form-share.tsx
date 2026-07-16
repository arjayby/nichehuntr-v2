import { cn } from "@nichehuntr-v2/ui/lib/utils";

import { describeFormShare, type Share } from "@/lib/search/formShare";

/**
 * What a Channel *makes* against what actually *works* for it: Shorts Upload Share and Shorts
 * View Share, side by side, with the gap between them spelled out.
 *
 * Two bars on a shared scale, and never a single badge. A Channel that is 90% Shorts by upload
 * and 10% by views is not a "Shorts channel", and any control that collapsed these two numbers
 * into one word would say that it is — destroying the most valuable thing on the row. The bars
 * make the gap visible; the note underneath makes it legible without the user having to
 * subtract two percentages by eye.
 */
function ShareBar({
	label,
	share,
	className,
}: {
	label: string;
	share: Share;
	className: string;
}) {
	return (
		<div className="flex items-center gap-2">
			<span className="w-10 shrink-0 text-[0.7rem] text-muted-foreground">
				{label}
			</span>
			<div
				className="h-1.5 flex-1 bg-foreground/10"
				// The bar is decoration on a number that is already printed beside it, so it is
				// hidden from the accessibility tree rather than duplicated into it.
				aria-hidden="true"
			>
				<div
					className={cn("h-full", className)}
					style={{ width: `${share.percent}%` }}
				/>
			</div>
			<span className="w-9 shrink-0 text-right text-[0.7rem] tabular-nums">
				{share.label}
			</span>
		</div>
	);
}

export function FormShareBars({
	shortsUploadShare,
	shortsViewShare,
}: {
	shortsUploadShare: number | undefined;
	shortsViewShare: number | undefined;
}) {
	const { measured, upload, view, note } = describeFormShare({
		shortsUploadShare,
		shortsViewShare,
	});

	return (
		<fieldset
			aria-label="Shorts upload share and view share"
			className="flex flex-col gap-1"
		>
			{measured && upload && view ? (
				<>
					<ShareBar label="makes" share={upload} className="bg-sky-500" />
					<ShareBar label="works" share={view} className="bg-emerald-500" />
					{note ? (
						<p className="text-[0.7rem] text-amber-500 leading-snug">{note}</p>
					) : null}
				</>
			) : (
				// A Channel with no recent uploads has no Form Share — not a Form Share of zero.
				// "0%" would say it makes no Shorts, about a Channel we have not seen upload at all.
				<p className="text-[0.7rem] text-muted-foreground">
					Shorts mix not measured — no recent uploads to measure.
				</p>
			)}
		</fieldset>
	);
}
