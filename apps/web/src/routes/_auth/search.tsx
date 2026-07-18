import { api } from "@nichehuntr-v2/backend/convex/_generated/api";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";

import { SaveNicheControl } from "@/components/niches/save-niche-control";
import { SearchScreen } from "@/components/search/search-screen";
import { nicheCriteriaFrom } from "@/lib/niches/niche";
import { EMPTY_CRITERIA, type SearchCriteria } from "@/lib/search/criteria";
import { useChannelSearch } from "@/lib/search/use-channel-search";

export const Route = createFileRoute("/_auth/search")({
	component: SearchPage,
});

/**
 * The search route: holds the criteria, runs the search, and lets the user save what they built
 * as a Niche.
 *
 * The fetching lives in `useChannelSearch`, shared with re-running a Niche, so "run this search"
 * means one thing across the app. Saving stores the *current* criteria (`nicheCriteriaFrom`), not
 * any results — a Niche is a living query, and re-running it later measures the index as it is
 * then. Nothing on this route spends a Credit: search is unlimited on every plan.
 */
function SearchPage() {
	const [criteria, setCriteria] = useState<SearchCriteria>(EMPTY_CRITERIA);
	const { results, isSearching, error } = useChannelSearch(criteria);

	const save = useMutation(api.niches.manage.save);
	const [saving, setSaving] = useState(false);

	const onSave = (name: string) => {
		setSaving(true);
		save({ name, criteria: nicheCriteriaFrom(criteria) })
			.then(() => toast.success(`Saved “${name}” to your Niches`))
			.catch((err: Error) => toast.error(err.message))
			.finally(() => setSaving(false));
	};

	return (
		<SearchScreen
			criteria={criteria}
			onCriteriaChange={setCriteria}
			results={results}
			isSearching={isSearching}
			error={error}
			headerActions={<SaveNicheControl onSave={onSave} saving={saving} />}
		/>
	);
}
