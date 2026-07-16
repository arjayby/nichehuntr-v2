/**
 * The Discovery screen's search criteria: what a user may filter on, what they may sort by,
 * and how the boxes they type in become the search the backend runs.
 *
 * Pure and free of React on purpose. The screen's rules — a percentage is a ratio, a
 * half-typed number is not a filter, changing anything returns you to page one — are the part
 * worth testing directly, and none of them needs a DOM to be true.
 *
 * Search is unlimited and free on every plan (see
 * `docs/adr/0002-credits-meter-discovery-not-search.md`). Nothing in this module, and nothing
 * on the screen it drives, spends a Credit: Discovery is the metered act, and it is not here.
 */

/** Every field a user may filter on: the Signals they scope by, plus the two raw stats. */
export type FilterField =
	| "subscriberCount"
	| "totalViewCount"
	| "momentum"
	| "viewsPerSubscriber"
	| "shortsUploadShare"
	| "shortsViewShare"
	| "uploadCadencePerWeek"
	| "channelAgeDays";

/**
 * Every field a user may sort by — each one a Signal, and not one of them a raw stat.
 *
 * Sorting by subscriber or total-view count ranks Channels by how hard they are to compete
 * with, which is the opposite of the question this product answers, so the ban is in the type:
 * a sort on raw size does not fail a review, it fails to compile. The backend rejects one at
 * the wire too — this is the same rule held a second time, where the user meets it.
 */
export type SortField =
	| "momentum"
	| "viewsPerSubscriber"
	| "medianViewsPerVideo"
	| "outlierRatio"
	| "uploadCadencePerWeek"
	| "channelAgeDays"
	| "shortsViewShare";

export type SortDirection = "asc" | "desc";

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
		help: "How big the Channel is. A filter, never a sort — size says how hard it would be to compete, not whether the niche is open.",
		unit: "subscribers",
		divisor: 1,
		placeholder: { min: "10000", max: "200000" },
	},
	{
		field: "totalViewCount",
		label: "Total views",
		help: "Views across the Channel's whole life — proven demand, as opposed to noise.",
		unit: "views",
		divisor: 1,
		placeholder: { min: "100000", max: "" },
	},
	{
		field: "momentum",
		label: "Momentum",
		help: "Views on its recent Videos against its own lifetime average. Above 1 means it is heating up right now.",
		unit: "×",
		divisor: 1,
		placeholder: { min: "2", max: "" },
	},
	{
		field: "viewsPerSubscriber",
		label: "Views per subscriber",
		help: "High means the content does the work rather than the audience — the format is cloneable.",
		unit: "views/sub",
		divisor: 1,
		placeholder: { min: "50", max: "" },
	},
	{
		field: "shortsUploadShare",
		label: "Shorts upload share",
		help: "The share of its recent uploads that are Shorts — what the Channel makes.",
		unit: "%",
		divisor: 100,
		placeholder: { min: "0", max: "100" },
	},
	{
		field: "shortsViewShare",
		label: "Shorts view share",
		help: "The share of its recent views that came from Shorts — what actually works for it.",
		unit: "%",
		divisor: 100,
		placeholder: { min: "70", max: "100" },
	},
	{
		field: "uploadCadencePerWeek",
		label: "Upload cadence",
		help: "Videos per week — the labour the niche demands of you. Five a week is a different business from one.",
		unit: "videos/week",
		divisor: 1,
		placeholder: { min: "1", max: "5" },
	},
	{
		field: "channelAgeDays",
		label: "Channel age",
		help: "Days since the Channel was created. A young Channel that has broken through proves the niche is enterable now.",
		unit: "days",
		divisor: 1,
		placeholder: { min: "0", max: "365" },
	},
];

export type SortOption = {
	id: string;
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
	sortId: string;
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

export const sortOptionFor = (sortId: string): SortOption =>
	sortById.get(sortId) ?? (SORT_OPTIONS[0] as SortOption);

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

export const setSort = (
	criteria: SearchCriteria,
	sortId: string,
): SearchCriteria => changed(criteria, { sortId });

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
