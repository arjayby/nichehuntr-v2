/**
 * The search screen's criteria: what a user may filter on, what they may sort by, and how the
 * boxes they type in become the search the backend runs.
 *
 * Pure and free of React on purpose. The screen's rules — a percentage is a ratio, a
 * half-typed number is not a filter, changing anything returns you to page one — are the part
 * worth testing directly, and none of them needs a DOM to be true.
 *
 * Search is unlimited and free on every plan (see
 * `docs/adr/0002-credits-meter-discovery-not-search.md`). Nothing in this module, and nothing
 * on the screen it drives, spends a Credit: Discovery is the metered act, and it is not here.
 */
import type {
	NumericField,
	SortableField,
} from "@nichehuntr-v2/backend/convex/search/searchIndex";

/**
 * Every field a user may filter on: the Signals they scope by, plus the two raw stats.
 *
 * Drawn from the projection's own `NumericField` rather than merely spelled like it, so a field
 * the engine stops holding cannot go on being offered here — it stops compiling instead. The
 * list is narrower than `NumericField` on purpose: it is the product's filter list, and the
 * Growth Metrics the engine can filter are not on it, because every one of them is absent until
 * a Channel has ~30 days of Snapshots and a filter nothing can satisfy is not a filter.
 */
export type FilterField = Extract<
	NumericField,
	| "subscriberCount"
	| "totalViewCount"
	| "momentum"
	| "viewsPerSubscriber"
	| "shortsUploadShare"
	| "shortsViewShare"
	| "uploadCadencePerWeek"
	| "channelAgeDays"
>;

/**
 * Every field a user may sort by — each one a Signal, and not one of them a raw stat.
 *
 * Sorting by subscriber or total-view count ranks Channels by how hard they are to compete
 * with, which is the opposite of the question this product answers, so the ban is in the type:
 * it is drawn from `SortableField`, which the backend derives with the raw stats already
 * excluded. A sort on raw size does not fail a review, it fails to compile — and the backend
 * rejects one at the wire besides, because that is where an untyped client meets the rule.
 *
 * These are exactly the Signals CONTEXT.md enumerates. Two asymmetries against the filter list
 * above are deliberate: Median Views per Video and Outlier Ratio are sorts but not filters
 * (nobody thinks in "median views between X and Y" — they want the best ones first), and Shorts
 * Upload Share is a filter but not a sort (what a Channel *makes* narrows a search; what
 * *works* for it is the Signal worth ranking by, and that is Shorts View Share).
 */
export type SortField = Extract<
	SortableField,
	| "momentum"
	| "viewsPerSubscriber"
	| "medianViewsPerVideo"
	| "outlierRatio"
	| "uploadCadencePerWeek"
	| "channelAgeDays"
	| "shortsViewShare"
>;

export type SortDirection = "asc" | "desc";

/**
 * The one sentence that explains each field, in the user's terms.
 *
 * One home, read by both the filter that narrows on a field and the row that prints it. CONTEXT
 * makes "explainable in one sentence" a property of the Signal itself, not of the control that
 * happens to show it — and two copies of a sentence are two sentences, which is what these were
 * becoming.
 */
export const FIELD_HELP: Record<FilterField | SortField, string> = {
	subscriberCount:
		"How big the Channel is. A filter, never a sort — size says how hard it would be to compete, not whether the niche is open.",
	totalViewCount:
		"Views across the Channel's whole life — proven demand, as opposed to noise.",
	momentum:
		"Views on its recent Videos against its own lifetime average. Above 1× means it is heating up right now.",
	viewsPerSubscriber:
		"Views earned per subscriber. High means the content does the work rather than the audience — the format is cloneable.",
	medianViewsPerVideo:
		"What a typical Video does here, immune to a single viral fluke.",
	outlierRatio:
		"Its best recent Video against its own typical Video — a specific idea that just printed.",
	uploadCadencePerWeek:
		"Videos per week — the labour the niche demands of you. Five a week is a different business from one.",
	channelAgeDays:
		"Days since the Channel was created. A young Channel that has broken through proves the niche is enterable now.",
	shortsUploadShare:
		"The share of its recent uploads that are Shorts — what the Channel makes.",
	shortsViewShare:
		"The share of its recent views that came from Shorts — what actually works for it.",
};

export type RangeFilter = {
	field: FilterField;
	label: string;
	/** What the filter means, in one sentence, in the user's terms. */
	help: string;
	/** What the typed number is measured in, shown beside the boxes. */
	unit: string;
	/**
	 * What to divide a typed number by to get the number the index holds. `100` for the shares,
	 * which a user reads and types as a percentage and the index stores as a 0–1 ratio.
	 *
	 * A divisor rather than the multiplier it reads as (`× 0.01`) because the multiplier is not
	 * exact in binary: `70 * 0.01` is `0.7000000000000001`, which as a lower bound excludes a
	 * Channel whose Shorts View Share is exactly `0.7` — a Channel silently dropped from a
	 * filter it sits precisely on. `70 / 100` is `0.7`.
	 */
	divisor: number;
	placeholder: { min: string; max: string };
};

/**
 * The filters, in the order they are shown: the two raw stats first, because "who could I
 * actually compete with" is the question a creator narrows by before any Signal is interesting.
 */
export const RANGE_FILTERS: readonly RangeFilter[] = [
	{
		field: "subscriberCount",
		label: "Subscribers",
		help: FIELD_HELP.subscriberCount,
		unit: "subscribers",
		divisor: 1,
		placeholder: { min: "10000", max: "200000" },
	},
	{
		field: "totalViewCount",
		label: "Total views",
		help: FIELD_HELP.totalViewCount,
		unit: "views",
		divisor: 1,
		placeholder: { min: "100000", max: "" },
	},
	{
		field: "momentum",
		label: "Momentum",
		help: FIELD_HELP.momentum,
		unit: "×",
		divisor: 1,
		placeholder: { min: "2", max: "" },
	},
	{
		field: "viewsPerSubscriber",
		label: "Views per subscriber",
		help: FIELD_HELP.viewsPerSubscriber,
		unit: "views/sub",
		divisor: 1,
		placeholder: { min: "50", max: "" },
	},
	{
		field: "shortsUploadShare",
		label: "Shorts upload share",
		help: FIELD_HELP.shortsUploadShare,
		unit: "%",
		divisor: 100,
		placeholder: { min: "0", max: "100" },
	},
	{
		field: "shortsViewShare",
		label: "Shorts view share",
		help: FIELD_HELP.shortsViewShare,
		unit: "%",
		divisor: 100,
		placeholder: { min: "70", max: "100" },
	},
	{
		field: "uploadCadencePerWeek",
		label: "Upload cadence",
		help: FIELD_HELP.uploadCadencePerWeek,
		unit: "videos/week",
		divisor: 1,
		placeholder: { min: "1", max: "5" },
	},
	{
		field: "channelAgeDays",
		label: "Channel age",
		help: FIELD_HELP.channelAgeDays,
		unit: "days",
		divisor: 1,
		placeholder: { min: "0", max: "365" },
	},
];

/**
 * A sort, named as one string so it can be the value of a `<select>` — the one place a sort has
 * to survive as text. Spelled out of the two types it is made of, so a typo is a compile error
 * rather than a sort that silently does nothing.
 */
export type SortOptionId = `${SortField}:${SortDirection}`;

export type SortOption = {
	id: SortOptionId;
	field: SortField;
	direction: SortDirection;
	/** What this sort puts at the top, said plainly. Never a bare field name. */
	label: string;
};

/**
 * Each sortable Signal, with what each end of it actually means. Both ends are offered: the
 * interesting end of most Signals is the high one, but not of all — the least demanding Channel
 * and the youngest are the interesting ends of Cadence and Age — and a user who wants to see the
 * cooling end of a Signal is entitled to.
 *
 * Every label says what comes *first*, because "Momentum, descending" asks the user to know what
 * Momentum is and which way it points before they can order a list by it. Every Signal here is
 * explainable in one sentence and checkable by eye; there is no composite score, deliberately.
 */
const SORTABLE_SIGNALS: readonly {
	field: SortField;
	high: string;
	low: string;
}[] = [
	{
		field: "momentum",
		high: "Heating up fastest first",
		low: "Cooling fastest first",
	},
	{
		field: "viewsPerSubscriber",
		high: "Most views per subscriber first",
		low: "Fewest views per subscriber first",
	},
	{
		field: "medianViewsPerVideo",
		high: "Best typical Video first",
		low: "Weakest typical Video first",
	},
	{
		field: "outlierRatio",
		high: "Biggest recent breakout first",
		low: "Most consistent first",
	},
	{
		field: "uploadCadencePerWeek",
		high: "Most uploads per week first",
		low: "Least work per week first",
	},
	{
		field: "channelAgeDays",
		high: "Oldest Channel first",
		low: "Youngest Channel first",
	},
	{
		field: "shortsViewShare",
		high: "Most Shorts-driven views first",
		low: "Least Shorts-driven views first",
	},
];

export const SORT_OPTIONS: readonly SortOption[] = SORTABLE_SIGNALS.flatMap(
	({ field, high, low }) => [
		{ id: `${field}:desc`, field, direction: "desc" as const, label: high },
		{ id: `${field}:asc`, field, direction: "asc" as const, label: low },
	],
);

/** What the user has typed into one filter's two boxes, kept as text. */
export type FilterInput = { min: string; max: string };

export type SearchCriteria = {
	keyword: string;
	filters: Partial<Record<FilterField, FilterInput>>;
	/** The id of the chosen `SortOption`. */
	sortId: SortOptionId;
	/** 0-based, as the backend counts. */
	page: number;
};

/**
 * An unfiltered search sorted by Momentum: the Signal computable from a single crawl, and so
 * the only one that means anything on a Channel discovered a minute ago. Every other Signal
 * either needs history we may not have yet or answers a narrower question.
 */
export const EMPTY_CRITERIA: SearchCriteria = {
	keyword: "",
	filters: {},
	sortId: "momentum:desc",
	page: 0,
};

const filterByField = new Map(
	RANGE_FILTERS.map((filter) => [filter.field, filter]),
);

const sortById = new Map(SORT_OPTIONS.map((option) => [option.id, option]));

/**
 * The sort an id names, or an error.
 *
 * Thrown at rather than defaulted to Momentum: the only thing that produces one of these is a
 * `<select>` we rendered from `SORT_OPTIONS` ourselves, so an id nothing matches is our bug, and
 * quietly sorting by Momentum instead would hide it behind a list that looks fine. The backend
 * takes the same line with a page number it cannot honour.
 */
export function sortOptionFor(sortId: string): SortOption {
	const option = sortById.get(sortId as SortOptionId);
	if (option === undefined) {
		throw new Error(`No sort is offered for "${sortId}"`);
	}
	return option;
}

/**
 * A typed bound as the number the index holds, or `undefined` if it is not a number yet.
 *
 * These boxes are text: mid-type they hold "", "-", "1e" and "1.". None of those is a filter,
 * and none of them is an error either — the user is still typing. They are simply not sent.
 */
function boundOf(raw: string, divisor: number): number | undefined {
	const trimmed = raw.trim();
	if (trimmed === "") {
		return undefined;
	}
	const value = Number(trimmed);
	return Number.isFinite(value) ? value / divisor : undefined;
}

/** The fields the user has actually narrowed by — the ones worth offering to clear. */
export function activeFilterFields(criteria: SearchCriteria): FilterField[] {
	return RANGE_FILTERS.map((filter) => filter.field).filter((field) => {
		const input = criteria.filters[field];
		return (
			input !== undefined &&
			(input.min.trim() !== "" || input.max.trim() !== "")
		);
	});
}

/**
 * The search these criteria describe, in the backend's own terms.
 *
 * Only what the user actually asked for is sent: an empty keyword, an untouched filter and a
 * half-typed bound are all left out entirely rather than sent as an empty string or a zero. A
 * `min: 0` on a Signal is a real filter that excludes every Channel whose Signal is unknown,
 * which is not what an empty box means.
 */
export function toSearchArgs(criteria: SearchCriteria) {
	const filters: Partial<Record<FilterField, { min?: number; max?: number }>> =
		{};

	for (const [field, input] of Object.entries(criteria.filters) as [
		FilterField,
		FilterInput,
	][]) {
		const { divisor } = filterByField.get(field) as RangeFilter;
		const min = boundOf(input.min, divisor);
		const max = boundOf(input.max, divisor);
		if (min === undefined && max === undefined) {
			continue;
		}
		filters[field] = {
			...(min === undefined ? {} : { min }),
			...(max === undefined ? {} : { max }),
		};
	}

	const keyword = criteria.keyword.trim();
	const { field, direction } = sortOptionFor(criteria.sortId);

	return {
		...(keyword === "" ? {} : { keyword }),
		...(Object.keys(filters).length === 0 ? {} : { filters }),
		sort: [{ field, direction }],
		page: criteria.page,
	};
}

/**
 * Every change to the criteria sends the user back to page one.
 *
 * Page 5 of one search is not page 5 of another: keeping the page across a change would land
 * them on a page the new result set may not have, and an empty page reads as "no matches" —
 * exactly the false negative this product exists to avoid.
 */
const changed = (
	criteria: SearchCriteria,
	change: Partial<SearchCriteria>,
) => ({
	...criteria,
	...change,
	page: 0,
});

export const setKeyword = (
	criteria: SearchCriteria,
	keyword: string,
): SearchCriteria => changed(criteria, { keyword });

/** Takes the `<select>`'s string and validates it into a sort, so an unknown id throws here. */
export const setSort = (
	criteria: SearchCriteria,
	sortId: string,
): SearchCriteria => changed(criteria, { sortId: sortOptionFor(sortId).id });

export function setBound(
	criteria: SearchCriteria,
	field: FilterField,
	bound: keyof FilterInput,
	raw: string,
): SearchCriteria {
	const current = criteria.filters[field] ?? { min: "", max: "" };
	return changed(criteria, {
		filters: { ...criteria.filters, [field]: { ...current, [bound]: raw } },
	});
}

/**
 * Drops one filter, leaving every other one standing — so a user can loosen a single
 * constraint without rebuilding the thesis they spent five minutes expressing.
 */
export function clearFilter(
	criteria: SearchCriteria,
	field: FilterField,
): SearchCriteria {
	const { [field]: _removed, ...rest } = criteria.filters;
	return changed(criteria, { filters: rest });
}

export const clearAllFilters = (criteria: SearchCriteria): SearchCriteria =>
	changed(criteria, { filters: {} });

export const goToPage = (
	criteria: SearchCriteria,
	page: number,
): SearchCriteria => ({ ...criteria, page });
