/**
 * A Niche's stored criteria: the set-defining query a user saved — a keyword, a set of numeric
 * range filters, and a sort. This is the canonical, engine-facing form (filters as the 0–1
 * ratios and raw numbers the index holds, not the percentages a user types), because a Niche
 * *is* a set-defining query and the set is defined by those numbers, not by the text a box
 * happened to contain.
 *
 * Deliberately not a frozen result. A Niche stores criteria, never Channels: re-running it asks
 * the engine again and returns *current* results, so a Niche is a living view of the index and
 * not a snapshot of it (CONTEXT.md, "Niche").
 *
 * Built from the SearchIndex port's own validators — the same `rangeFiltersValidator` a search
 * accepts and the same `sortKeyValidator` it sorts by — so a filter a Niche can hold is exactly
 * a filter a search can run, and a Niche can never store a sort on raw size the search API would
 * reject (`SortableField`). One page of criteria feeds straight into `searchChannels`.
 */
import { type Infer, v } from "convex/values";
import { rangeFiltersValidator, sortKeyValidator } from "../search/searchIndex";

export const nicheCriteriaValidator = v.object({
	/** The keyword the search runs. Empty string means an unkeyworded filter-and-sort. */
	keyword: v.string(),
	/** The numeric range filters, keyed by field — the same shape a search takes. */
	filters: rangeFiltersValidator,
	/**
	 * The single sort the saved view opens on. A sort does not change *which* Channels are in
	 * the set — the match count a Niche is measured by is the same however it is ordered — but it
	 * is part of the view the user saved, so re-running restores the order they left it in.
	 */
	sort: sortKeyValidator,
});

export type NicheCriteria = Infer<typeof nicheCriteriaValidator>;

/**
 * The Niches a new user starts with, so their first measurements are of *coherent* sets rather
 * than of an incoherent query invented in ten seconds (CONTEXT.md, "Niche"). Each is a set a
 * creator would actually want to measure — a thesis in a query — and each leads with the sort
 * that makes the set legible.
 *
 * These are ordinary Niches once granted: a starter is editable and deletable like any other. A
 * user is given them once (see `nicheStarterGrants`), not handed them back every time they clear
 * the slate — deleting a starter is a choice, not an accident to undo.
 */
export const STARTER_NICHES: readonly {
	name: string;
	criteria: NicheCriteria;
}[] = [
	{
		// Momentum is the one Signal computable from a single crawl, so a set sorted by it
		// means something even where the index is young — the right first thing to show.
		name: "Heating up right now",
		criteria: {
			keyword: "",
			filters: { momentum: { min: 1.5 } },
			sort: { field: "momentum", direction: "desc" },
		},
	},
	{
		// High views per subscriber is the best proxy for format-driven, cloneable content:
		// the content does the work, not the audience.
		name: "Cloneable formats",
		criteria: {
			keyword: "",
			filters: { viewsPerSubscriber: { min: 50 } },
			sort: { field: "viewsPerSubscriber", direction: "desc" },
		},
	},
	{
		// A young Channel that has broken through proves the niche is enterable *now*, not a
		// decade ago — youngest first, with a floor on subscribers so a breakthrough is real.
		name: "Young channels breaking through",
		criteria: {
			keyword: "",
			filters: {
				channelAgeDays: { max: 365 },
				subscriberCount: { min: 50_000 },
			},
			sort: { field: "channelAgeDays", direction: "asc" },
		},
	},
	{
		// Shorts that actually *work*: filtered and sorted on view share, not upload share, so
		// a Channel that merely posts Shorts without them landing does not qualify.
		name: "Shorts that actually work",
		criteria: {
			keyword: "",
			filters: { shortsViewShare: { min: 0.7 } },
			sort: { field: "shortsViewShare", direction: "desc" },
		},
	},
];
