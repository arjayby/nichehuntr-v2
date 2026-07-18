/**
 * The bridge between a saved Niche and the search screen: turning the screen's current criteria
 * into the canonical form a Niche stores, turning a stored Niche back into criteria the screen
 * can run and edit, and describing a Niche in a line a user can read.
 *
 * Pure and free of React, the same as `search/criteria` it sits beside. The interesting rules
 * live here — a stored `0.7` Shorts View Share is the box the user typed `70` into, and reading
 * it back must show `70` and not `70.00000000000001` — and none of them needs a DOM to be true.
 *
 * A Niche stores the *engine-facing* numbers (the 0–1 ratios and raw counts the index holds),
 * not the percentages a user types, because a Niche is a set-defining query and the set is
 * defined by those numbers. The screen is where the percentage lives, so the conversion between
 * the two is exactly this module.
 */
import type { NicheCriteria } from "@nichehuntr-v2/backend/convex/niches/criteria";

import {
	EMPTY_CRITERIA,
	type FilterField,
	type FilterInput,
	RANGE_FILTERS,
	type SearchCriteria,
	SORT_OPTIONS,
	type SortOptionId,
	toSearchArgs,
} from "@/lib/search/criteria";

/**
 * The number a stored bound shows as in its box, cleaned of binary-float noise.
 *
 * A Shorts View Share is stored as the ratio `0.7` but typed and read as the percentage `70`,
 * so reading it back multiplies by the divisor — and `0.7 * 100` is `70.00000000000001` in
 * IEEE-754. `toPrecision` collapses that trailing noise before it can reach a box the user is
 * meant to recognise as the `70` they typed. For the raw stats the divisor is `1` and the number
 * is returned untouched.
 */
function displayNumber(value: number, divisor: number): number {
	return Number.parseFloat((value * divisor).toPrecision(12));
}

/** A stored bound as the text its box holds — no thousands separators, so it parses straight back. */
function boundText(value: number, divisor: number): string {
	return String(displayNumber(value, divisor));
}

/**
 * The canonical criteria a Niche stores, taken from what the screen currently shows.
 *
 * Routed through `toSearchArgs` so a saved Niche holds exactly the search the screen would have
 * run — the same trimmed keyword, the same numeric ranges with half-typed bounds dropped, the
 * same sort — and never drifts from it. The page is left behind: a Niche is a set, and where in
 * that set the user had scrolled is not part of what defines it.
 */
export function nicheCriteriaFrom(criteria: SearchCriteria): NicheCriteria {
	const args = toSearchArgs(criteria);
	return {
		keyword: args.keyword ?? "",
		filters: args.filters ?? {},
		sort: args.sort[0],
	};
}

/**
 * A stored Niche as the screen's editable criteria: its keyword, its bounds back in the boxes
 * they were typed into, its sort in the `<select>`, and always page one — re-running a Niche
 * starts at the top of its *current* results, never wherever the last view happened to be.
 *
 * Only fields the screen actually offers are surfaced (it walks `RANGE_FILTERS`), so a Niche that
 * somehow held a filter the product no longer exposes would simply not show it rather than break
 * the screen. A sort the screen no longer offers falls back to the default rather than throwing,
 * for the same reason: a saved view should degrade, not fail.
 */
export function searchCriteriaFrom(niche: NicheCriteria): SearchCriteria {
	const filters: Partial<Record<FilterField, FilterInput>> = {};
	for (const filter of RANGE_FILTERS) {
		const range = niche.filters[filter.field];
		if (range === undefined) {
			continue;
		}
		const { min, max } = range;
		if (min === undefined && max === undefined) {
			continue;
		}
		filters[filter.field] = {
			min: min === undefined ? "" : boundText(min, filter.divisor),
			max: max === undefined ? "" : boundText(max, filter.divisor),
		};
	}

	const sortId = `${niche.sort.field}:${niche.sort.direction}` as SortOptionId;
	const known = SORT_OPTIONS.some((option) => option.id === sortId);

	return {
		keyword: niche.keyword,
		filters,
		sortId: known ? sortId : EMPTY_CRITERIA.sortId,
		page: 0,
	};
}

/** How a bound reads in a description: grouped for the eye — `10,000`, not `10000`. */
function readableBound(value: number, divisor: number): string {
	return displayNumber(value, divisor).toLocaleString("en-US");
}

/** The unit attached the way it reads: `70%` and `2×` sit tight, `10,000 subscribers` spaces out. */
function withUnit(text: string, unit: string): string {
	return unit === "%" || unit === "×" ? `${text}${unit}` : `${text} ${unit}`;
}

/** What one sort puts first, said plainly — its own label, or the field name if it is unknown. */
function sortLabel(sort: NicheCriteria["sort"]): string {
	const id = `${sort.field}:${sort.direction}` as SortOptionId;
	const option = SORT_OPTIONS.find((candidate) => candidate.id === id);
	return option?.label ?? `${sort.field} ${sort.direction}`;
}

/**
 * A Niche in a handful of readable phrases — its keyword, each filter it narrows by, and what it
 * sorts to the top — so the list can show what a saved set actually asks for without re-running
 * it. The sort is always shown; a Niche always has one, and it is part of the view that was saved.
 */
export function describeNiche(niche: NicheCriteria): string[] {
	const parts: string[] = [];

	const keyword = niche.keyword.trim();
	if (keyword !== "") {
		parts.push(`“${keyword}”`);
	}

	for (const filter of RANGE_FILTERS) {
		const range = niche.filters[filter.field];
		if (range === undefined) {
			continue;
		}
		const { min, max } = range;
		if (min === undefined && max === undefined) {
			continue;
		}
		const value =
			min !== undefined && max !== undefined
				? `${readableBound(min, filter.divisor)}–${readableBound(max, filter.divisor)}`
				: min !== undefined
					? `≥ ${readableBound(min, filter.divisor)}`
					: `≤ ${readableBound(max as number, filter.divisor)}`;
		parts.push(`${filter.label}: ${withUnit(value, filter.unit)}`);
	}

	parts.push(`Sorted: ${sortLabel(niche.sort)}`);
	return parts;
}
