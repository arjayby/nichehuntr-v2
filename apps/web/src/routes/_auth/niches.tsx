import { api } from "@nichehuntr-v2/backend/convex/_generated/api";
import type { SavedNiche } from "@nichehuntr-v2/backend/convex/niches/manage";
import { Button } from "@nichehuntr-v2/ui/components/button";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";

import { NichesManager } from "@/components/niches/niches-manager";
import { SearchScreen } from "@/components/search/search-screen";
import {
	describeNiche,
	nicheCriteriaFrom,
	searchCriteriaFrom,
} from "@/lib/niches/niche";
import type { SearchCriteria } from "@/lib/search/criteria";
import { useChannelSearch } from "@/lib/search/use-channel-search";

export const Route = createFileRoute("/_auth/niches")({
	component: NichesPage,
});

/**
 * The Niches route: a user's saved sets, and a way to re-run one against the current index.
 *
 * A new visitor is provisioned with good starter Niches on arrival (`ensureStarters`), so their
 * first measurements are of coherent sets rather than of a query they invented in ten seconds —
 * the grant is once-only, so a user who cleared theirs on purpose is left alone.
 *
 * Opening a Niche does not show stored results; it runs the search the Niche stands for and shows
 * *current* ones, because a Niche is a living view of the index and never a snapshot of it.
 */
function NichesPage() {
	const niches = useQuery(api.niches.manage.list);
	const update = useMutation(api.niches.manage.update);
	const remove = useMutation(api.niches.manage.remove);

	// Starter Niches are provisioned once by the shared `_auth` layout, whichever page the user
	// lands on first — so a new visitor here already has coherent sets to measure.
	const [open, setOpen] = useState<SavedNiche | null>(null);

	if (open !== null) {
		return (
			<NicheRunner
				niche={open}
				onBack={() => setOpen(null)}
				onUpdate={(criteria) =>
					update({ nicheId: open.id, criteria })
						.then(() => toast.success(`Updated “${open.name}”`))
						.catch((err: Error) => toast.error(err.message))
				}
			/>
		);
	}

	return (
		<div className="overflow-y-auto">
			<div className="border-foreground/10 border-b p-4">
				<h1 className="font-semibold text-lg">Your Niches</h1>
				<p className="text-muted-foreground text-xs">
					A Niche is a saved set of search criteria. Open one to measure that
					set against the index as it is now — searching is always free.
				</p>
			</div>
			<NichesManager
				niches={niches}
				onOpen={setOpen}
				onRename={(niche, name) =>
					update({ nicheId: niche.id, name })
						.then(() => toast.success(`Renamed to “${name}”`))
						.catch((err: Error) => toast.error(err.message))
				}
				onDelete={(niche) =>
					remove({ nicheId: niche.id })
						.then(() => toast.success(`Deleted “${niche.name}”`))
						.catch((err: Error) => toast.error(err.message))
				}
			/>
		</div>
	);
}

/**
 * A Niche opened: the search it stands for, run live, with the criteria back in the boxes so the
 * user can tweak the thesis and save the change back to this Niche. The search itself is the
 * shared `useChannelSearch`, so an opened Niche runs exactly the search the search screen would.
 */
function NicheRunner({
	niche,
	onBack,
	onUpdate,
}: {
	niche: SavedNiche;
	onBack: () => void;
	onUpdate: (criteria: SavedNiche["criteria"]) => void;
}) {
	const [criteria, setCriteria] = useState<SearchCriteria>(() =>
		searchCriteriaFrom(niche.criteria),
	);
	const { results, isSearching, error } = useChannelSearch(criteria);

	return (
		<div className="grid grid-rows-[auto_1fr] overflow-hidden">
			<div className="flex items-center justify-between gap-3 border-foreground/10 border-b p-3">
				<div className="flex items-center gap-2">
					<Button type="button" variant="ghost" size="sm" onClick={onBack}>
						← Niches
					</Button>
					<span className="font-medium text-sm">{niche.name}</span>
				</div>
				<span className="text-muted-foreground text-xs">
					{describeNiche(niche.criteria).join(" · ")}
				</span>
			</div>
			<SearchScreen
				criteria={criteria}
				onCriteriaChange={setCriteria}
				results={results}
				isSearching={isSearching}
				error={error}
				headerActions={
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => onUpdate(nicheCriteriaFrom(criteria))}
					>
						Save changes to this Niche
					</Button>
				}
			/>
		</div>
	);
}
