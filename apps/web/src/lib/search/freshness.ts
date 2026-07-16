/**
 * Freshness, said in words: how long ago we last read a Channel, and how much to trust the
 * numbers sitting next to it.
 *
 * Refresh is tiered, so Freshness is uneven across the index — some Channels are read hourly,
 * some monthly. A stat presented without its Freshness is a claim we cannot support, which is
 * why every result row shows one and no caller may opt out.
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How much to trust the stats this Freshness qualifies.
 *
 * Three bands rather than a raw age, because "9 days" is a number a user has to interpret and
 * "aging" is one they can act on. The thresholds are a judgement about how fast a Channel's
 * numbers move, not a fact about the crawler: a week-old view count is usually directionally
 * right, a three-week-old one has had time to be wrong.
 */
export type FreshnessTone = "fresh" | "aging" | "stale";

const AGING_AFTER = 3 * DAY;
const STALE_AFTER = 14 * DAY;

export type Freshness = {
	/** How long ago we read it, e.g. "3 hours ago". */
	label: string;
	tone: FreshnessTone;
	/** The same claim spelled out, for a tooltip — a colour on its own says nothing. */
	title: string;
};

const plural = (count: number, unit: string) =>
	`${count} ${unit}${count === 1 ? "" : "s"} ago`;

/** The age, in the largest unit that still carries information. */
function labelFor(age: number): string {
	if (age < MINUTE) {
		return "just now";
	}
	if (age < HOUR) {
		return plural(Math.floor(age / MINUTE), "minute");
	}
	if (age < DAY) {
		return plural(Math.floor(age / HOUR), "hour");
	}
	return plural(Math.floor(age / DAY), "day");
}

function toneFor(age: number): FreshnessTone {
	if (age >= STALE_AFTER) {
		return "stale";
	}
	return age >= AGING_AFTER ? "aging" : "fresh";
}

const TITLES: Record<FreshnessTone, string> = {
	fresh: "Last read recently — these stats are current.",
	aging: "Last read a while ago — these stats may have moved.",
	stale:
		"These stats are stale. We have not read this Channel in a fortnight; treat them as a lower bound, not as current.",
};

/**
 * Describes a Channel's Freshness as of `now`.
 *
 * A Freshness from the future is floored at zero rather than rendered as a negative age: the
 * crawler's clock and the browser's are two different clocks, and a small skew between them is
 * ordinary. "In -3 hours" would be a data-quality claim we cannot actually make from here.
 */
export function describeFreshness(
	lastRefreshedAt: number,
	now: number = Date.now(),
): Freshness {
	const age = Math.max(0, now - lastRefreshedAt);
	const tone = toneFor(age);
	return { label: labelFor(age), tone, title: TITLES[tone] };
}
