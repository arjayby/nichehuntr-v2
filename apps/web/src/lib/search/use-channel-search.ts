/**
 * Running a Channel search from the screen's criteria — the fetching half of the search route,
 * pulled out so both the search screen and a re-run Niche share one definition of what "run this
 * search" means and cannot drift apart.
 *
 * A `useQuery` over a Convex *action*, not a reactive query: the search engine is reached over
 * HTTP, so results cannot live-update the way a Convex query would (ADR-0001). Re-running is what
 * refreshes them, and that is free — search is unlimited on every plan and nothing here spends a
 * Credit. It is also what makes a Niche a *living* view: re-running one measures the index as it
 * is now, never the results it matched when it was saved.
 */
import { convexAction } from "@convex-dev/react-query";
import { api } from "@nichehuntr-v2/backend/convex/_generated/api";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { type SearchCriteria, toSearchArgs } from "@/lib/search/criteria";
import { useDebouncedValue } from "@/lib/use-debounced-value";

/** Long enough to let a word finish, short enough that searching still feels like thinking. */
const SETTLE_MS = 250;

export function useChannelSearch(criteria: SearchCriteria) {
	const args = useMemo(() => toSearchArgs(criteria), [criteria]);
	const settled = useDebouncedValue(args, SETTLE_MS);

	const { data, isFetching, error } = useQuery({
		...convexAction(api.search.channels.searchChannels, settled),
		// The previous page stays on screen while the next one loads, so tightening a filter dims
		// the results rather than blanking them — an empty screen mid-search reads as "no matches",
		// which is the one answer this product must never give by accident.
		placeholderData: keepPreviousData,
	});

	return { results: data, isSearching: isFetching, error };
}
