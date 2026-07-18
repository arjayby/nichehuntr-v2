/**
 * Showing a Channel's numbers on a result row: the Signals it is ranked by, in the units they
 * are quoted in, each with the one sentence that explains it.
 *
 * Every Signal here is explainable in one sentence and checkable by eye — that sentence is the
 * `help` below, and it ships next to the number rather than in documentation nobody opens. There
 * is no composite score on a row, deliberately: we have no ground truth about which niches made
 * anyone money, so a blended number could never be justified to the user staking months on it.
 */
import { FIELD_HELP, type SortField } from "./criteria";

/** A Signal shown as a column, under the short label a narrow column has room for. */
export type SignalColumn = {
	field: SortField;
	label: string;
};

/**
 * The Signals shown together, in order: Momentum first, because it is the question the product
 * leads with — is this heating up right now. A search result row and a Channel's detail both
 * show exactly this set, so the sort a row is ranked by is checkable by eye against the same
 * numbers the detail lays out in full.
 *
 * Shorts View Share is the one sortable Signal absent here, because both surfaces show it beside
 * its Upload Share as a pair of bars instead: printed alone in this list it would be a single
 * number about a Channel's Form, which is the one thing that must never appear as a lone verdict.
 *
 * The sentence explaining each is not repeated here — a Signal's one sentence lives in
 * `FIELD_HELP`, and the grid reads it from there.
 */
export const CHANNEL_SIGNALS: readonly SignalColumn[] = [
	{ field: "momentum", label: "Momentum" },
	{ field: "viewsPerSubscriber", label: "Views/sub" },
	{ field: "medianViewsPerVideo", label: "Median views" },
	{ field: "outlierRatio", label: "Outlier" },
	{ field: "uploadCadencePerWeek", label: "Cadence" },
	{ field: "channelAgeDays", label: "Age" },
];

/**
 * A count as a creator reads it: 12,000 subscribers is "12K".
 *
 * One decimal place at most, and never a trailing ".0" — the precision is decoration on a number
 * this size, and a row full of it is a row nobody scans.
 */
export function formatCount(value: number): string {
	const units = [
		{ threshold: 1_000_000_000, suffix: "B" },
		{ threshold: 1_000_000, suffix: "M" },
		{ threshold: 1_000, suffix: "K" },
	];
	for (const { threshold, suffix } of units) {
		if (Math.abs(value) >= threshold) {
			const scaled = value / threshold;
			// One decimal below 10 ("1.5M"), none above it ("340K"): the digit stops carrying
			// information about the same time the number gets wide enough to crowd a row.
			const text =
				Math.abs(scaled) < 10
					? scaled.toFixed(1).replace(/\.0$/, "")
					: String(Math.round(scaled));
			return `${text}${suffix}`;
		}
	}
	return String(Math.round(value));
}

/** How each Signal is written once it has a value. */
const FORMATTERS: Record<SortField, (value: number) => string> = {
	momentum: (value) => `${value.toFixed(1)}×`,
	viewsPerSubscriber: (value) => formatCount(value),
	medianViewsPerVideo: (value) => formatCount(value),
	outlierRatio: (value) => `${value.toFixed(1)}×`,
	uploadCadencePerWeek: (value) => `${Number(value.toFixed(1))}/wk`,
	channelAgeDays: (value) => `${Math.round(value)}d`,
	shortsViewShare: (value) => `${Math.trunc(value * 100)}%`,
};

export type ShownSignal = {
	/** What the row prints. */
	text: string;
	/** The sentence explaining it, for a tooltip. */
	title: string;
};

/**
 * A Signal as a row shows it.
 *
 * An absent Signal prints an em dash and says "not measured", never a zero. The distinction is
 * load-bearing all the way down: the index stores absent rather than zero, the engine sorts
 * absent to the favourable end rather than the bottom, and a row that printed "0×" would undo
 * both — telling the user we measured a Channel and found nothing when the truth is that there
 * was nothing to measure yet.
 */
export function formatSignal(
	field: SortField,
	value: number | undefined,
): ShownSignal {
	const help = FIELD_HELP[field];
	if (value === undefined) {
		return { text: "—", title: `Not measured yet. ${help}` };
	}
	return { text: FORMATTERS[field](value), title: help };
}
