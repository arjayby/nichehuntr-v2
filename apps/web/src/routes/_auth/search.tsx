import { convexAction } from "@convex-dev/react-query";
import { api } from "@nichehuntr-v2/backend/convex/_generated/api";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { SearchScreen } from "@/components/search/search-screen";
import {
	EMPTY_CRITERIA,
	type SearchCriteria,
	toSearchArgs,
} from "@/lib/search/criteria";
import { useDebouncedValue } from "@/lib/use-debounced-value";

export const Route = createFileRoute("/_auth/search")({
	component: SearchPage,
});

/** Long enough to let a word finish, short enough that searching still feels like thinking. */
const SETTLE_MS = 250;

/**
 * The Discovery route: holds the criteria, runs the search, hands both to the screen.
 *
 * A `useQuery` over a Convex *action*, not a reactive query — the search engine is reached over
 * HTTP, so results cannot live-update the way a Convex query would (see
 * `docs/adr/0001-external-search-engine-for-channel-search.md`). Re-running a search is what
 * refreshes it, and that is free: search is unlimited on every plan, and nothing on this route
 * spends a Credit.
 */
function SearchPage() {
	const [criteria, setCriteria] = useState<SearchCriteria>(EMPTY_CRITERIA);
	const args = useMemo(() => toSearchArgs(criteria), [criteria]);
	const settled = useDebouncedValue(args, SETTLE_MS);

	const { data, isFetching, error } = useQuery({
		...convexAction(api.search.channels.searchChannels, settled),
		// The previous page stays on screen while the next one loads, so tightening a filter
		// dims the results rather than blanking them — an empty screen mid-search reads as "no
		// matches", which is the one answer this product must never give by accident.
		placeholderData: keepPreviousData,
	});

	return (
		<SearchScreen
			criteria={criteria}
			onCriteriaChange={setCriteria}
			results={data}
			isSearching={isFetching}
			error={error}
		/>
	);
}
