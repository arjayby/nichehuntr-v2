/**
 * Showing a Channel's numbers on a result row: the Signals it is ranked by, in the units they
 * are quoted in, each with the one sentence that explains it.
 *
 * Every Signal here is explainable in one sentence and checkable by eye — that sentence is the
 * `help` below, and it ships next to the number rather than in documentation nobody opens. There
 * is no composite score on a row, deliberately: we have no ground truth about which niches made
 * anyone money, so a blended number could never be justified to the user staking months on it.
 */
import type { SortField } from "./criteria";

/** A Signal shown on every row, with the sentence that says what it means. */
export type RowSignal = {
	field: SortField;
	label: string;
	help: string;
};

/**
 * The Signals a row shows, in the order it shows them: Momentum first, because it is the
 * question the product leads with — is this heating up right now.
 */
export const ROW_SIGNALS: readonly RowSignal[] = [
	{
		field: "momentum",
		label: "Momentum",
		help: "Views on its recent Videos against its own lifetime average. Above 1× means it is heating up.",
	},
	{
		field: "viewsPerSubscriber",
		label: "Views/sub",
		help: "Views earned per subscriber. High means the content does the work, not the audience — the format is cloneable.",
	},
	{
		field: "medianViewsPerVideo",
		label: "Median views",
		help: "What a typical Video does here, immune to a single viral fluke.",
	},
	{
		field: "outlierRatio",
		label: "Outlier",
		help: "Its best recent Video against its own typical Video — a specific idea that just printed.",
	},
	{
		field: "uploadCadencePerWeek",
		label: "Cadence",
		help: "Videos per week: the labour this niche demands of you.",
	},
	{
		field: "channelAgeDays",
		label: "Age",
		help: "How long the Channel has existed. Young and already working means the niche is enterable now.",
	},
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

const helpByField = new Map(
	ROW_SIGNALS.map((signal) => [signal.field, signal.help]),
);

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
	const help = helpByField.get(field) ?? "";
	if (value === undefined) {
		return {
			text: "—",
			title: `Not measured yet. ${help}`.trim(),
		};
	}
	return { text: FORMATTERS[field](value), title: help };
}
