/**
 * A Channel's two Form Shares, and the gap between them.
 *
 * A Channel has no Form. It has two ratios — Shorts Upload Share (what it *makes*) and Shorts
 * View Share (what actually *works* for it) — and the gap between them is one of the most
 * valuable things we know about it. A Channel that is 90% Shorts by upload and 10% by views is
 * telling you its Shorts are not its business, and a creator who clones its format is cloning
 * the wrong tenth of it.
 *
 * So this module never produces a verdict. There is no `shorts | longform | mixed` here, and no
 * threshold that would collapse the two numbers into one, because any such threshold destroys
 * exactly the gap the user needs to see. What it produces is both numbers, their distance, and
 * a sentence naming what that distance means.
 */

/** The two shares as the index holds them: 0–1, or absent when there was nothing to measure. */
export type FormShareInput = {
	shortsUploadShare: number | undefined;
	shortsViewShare: number | undefined;
};

/**
 * What the gap between the two shares is saying. Not a classification of the Channel — a
 * description of the distance between two of its numbers.
 */
export type Divergence =
	/** The shares disagree: it makes Shorts, its views come from long-form. The trap. */
	| "shorts-do-not-work"
	/** The shares disagree the other way: its Shorts punch above the share it uploads. */
	| "shorts-outperform"
	/** What it makes is roughly what works. The gap says nothing; we say nothing. */
	| "aligned"
	/** At least one share is absent, so there is no gap to speak of. */
	| "unmeasured";

export type Share = {
	/** 0–1, as held. */
	ratio: number;
	/** The same as a whole percent, e.g. "90%". */
	label: string;
	/** 0–100, for a bar's width. */
	percent: number;
};

export type FormShare = {
	/** Whether both shares are known, and so whether the gap means anything. */
	measured: boolean;
	upload: Share | undefined;
	view: Share | undefined;
	/** The distance between the two shares in percentage points, when both are known. */
	gapPoints: number | undefined;
	divergence: Divergence;
	/** What the gap means, in one sentence. Absent when the gap is not saying anything. */
	note: string | undefined;
};

/**
 * How far apart the two shares must be before the gap is worth a sentence.
 *
 * A judgement, and a deliberately loose one: shares wander by a few points for reasons that
 * mean nothing, and a note on every Channel is a note nobody reads. Thirty points is where the
 * gap stops being noise and starts being the story of the Channel. It is a threshold on whether
 * we *narrate* the gap — both numbers are always shown regardless, so the user can always see
 * the gap for themselves and disagree with us about it.
 */
const NOTABLE_GAP_POINTS = 30;

/**
 * Rounds a share to a whole percent, without rounding it into a claim.
 *
 * Truncated, not rounded to nearest: 0.996 shown as "100%" says a Channel makes nothing but
 * Shorts, when in fact it posts one long-form video in every 250 — and on this screen that
 * difference is the whole point.
 *
 * Truncation has the same failure at the other end, though — it would show 0.004 as "0%", which
 * says *none of its views come from Shorts* about a Channel where some do. So a share that is
 * real but rounds away reads "<1%": at both ends, "all" and "none" are claims this function is
 * not allowed to invent out of a rounding step.
 */
const shareOf = (ratio: number | undefined): Share | undefined => {
	if (ratio === undefined) {
		return undefined;
	}
	const percent = Math.trunc(ratio * 100);
	const vanished = percent === 0 && ratio > 0;
	return { ratio, label: vanished ? "<1%" : `${percent}%`, percent };
};

const NOTES: Record<Exclude<Divergence, "aligned" | "unmeasured">, string> = {
	"shorts-do-not-work":
		"Makes mostly Shorts, but its views come from long-form — its Shorts are not its business.",
	"shorts-outperform":
		"Its Shorts punch far above the share it uploads — a little of the format is doing most of the work.",
};

/**
 * Describes a Channel's Form Shares: both numbers, the gap, and what the gap means.
 *
 * An absent share is absent, never zero. A Channel that has not uploaded recently has no Shorts
 * Upload Share at all, and "0%" would say it makes no Shorts — a claim about a Channel we have
 * not seen upload anything. With either share missing there is no gap to narrate, so none is.
 */
export function describeFormShare({
	shortsUploadShare,
	shortsViewShare,
}: FormShareInput): FormShare {
	const upload = shareOf(shortsUploadShare);
	const view = shareOf(shortsViewShare);

	if (upload === undefined || view === undefined) {
		return {
			measured: false,
			upload,
			view,
			gapPoints: undefined,
			divergence: "unmeasured",
			note: undefined,
		};
	}

	const gapPoints = Math.abs(upload.percent - view.percent);
	const divergence: Divergence =
		gapPoints < NOTABLE_GAP_POINTS
			? "aligned"
			: upload.percent > view.percent
				? "shorts-do-not-work"
				: "shorts-outperform";

	return {
		measured: true,
		upload,
		view,
		gapPoints,
		divergence,
		note: divergence === "aligned" ? undefined : NOTES[divergence],
	};
}
