import type { SavedNiche } from "@nichehuntr-v2/backend/convex/niches/manage";
import { Button } from "@nichehuntr-v2/ui/components/button";
import { Input } from "@nichehuntr-v2/ui/components/input";
import { useState } from "react";

import { describeNiche } from "@/lib/niches/niche";

/**
 * The Niche library: a user's saved sets, each with the query it stands for, and the four things
 * they can do to one — open it (re-run it against the current index), rename it, edit it, delete
 * it.
 *
 * Presentational and complete. It renders the Niches it is given and reports what the user did;
 * it knows nothing about how a Niche is fetched, run, or stored. The route above wires opening to
 * a live search and the rest to Convex mutations. That split is what lets the whole library be
 * tested for what it promises — a Niche shows its criteria, a rename does not lose them, a delete
 * asks first — without a network in the way.
 *
 * `niches` is `undefined` while the list is loading and `[]` when the user genuinely has none;
 * the two are different things to say, so they render differently — a new user is never shown an
 * empty library as though they had cleared it.
 */
export type NichesManagerProps = {
	niches: SavedNiche[] | undefined;
	/** Re-run this Niche: the parent takes the user to its *current* results, never stored ones. */
	onOpen: (niche: SavedNiche) => void;
	onRename: (niche: SavedNiche, name: string) => void;
	onDelete: (niche: SavedNiche) => void;
};

/** One saved Niche: its name, the query it stands for, and the four things you can do to it. */
function NicheCard({
	niche,
	onOpen,
	onRename,
	onDelete,
}: {
	niche: SavedNiche;
	onOpen: (niche: SavedNiche) => void;
	onRename: (niche: SavedNiche, name: string) => void;
	onDelete: (niche: SavedNiche) => void;
}) {
	const [renaming, setRenaming] = useState(false);
	const [name, setName] = useState(niche.name);
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const trimmed = name.trim();
	const parts = describeNiche(niche.criteria);

	return (
		<div className="flex flex-col gap-2 border-foreground/10 border-b p-4">
			{renaming ? (
				<form
					className="flex items-center gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						if (trimmed === "") {
							return;
						}
						onRename(niche, trimmed);
						setRenaming(false);
					}}
				>
					<label className="sr-only" htmlFor={`rename-${niche.id}`}>
						Rename {niche.name}
					</label>
					<Input
						id={`rename-${niche.id}`}
						className="h-8 text-sm"
						value={name}
						onChange={(event) => setName(event.target.value)}
					/>
					<Button type="submit" size="sm" disabled={trimmed === ""}>
						Save
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={() => {
							setName(niche.name);
							setRenaming(false);
						}}
					>
						Cancel
					</Button>
				</form>
			) : (
				<div className="flex items-center justify-between gap-3">
					<h3 className="font-medium text-sm">{niche.name}</h3>
					<div className="flex items-center gap-1.5">
						<Button
							type="button"
							size="sm"
							aria-label={`Open ${niche.name}`}
							onClick={() => onOpen(niche)}
						>
							Open
						</Button>
						<Button
							type="button"
							variant="outline"
							size="sm"
							aria-label={`Rename ${niche.name}`}
							onClick={() => setRenaming(true)}
						>
							Rename
						</Button>
						{confirmingDelete ? (
							<>
								<Button
									type="button"
									variant="destructive"
									size="sm"
									aria-label={`Confirm delete ${niche.name}`}
									onClick={() => onDelete(niche)}
								>
									Delete?
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									onClick={() => setConfirmingDelete(false)}
								>
									Keep
								</Button>
							</>
						) : (
							<Button
								type="button"
								variant="ghost"
								size="sm"
								aria-label={`Delete ${niche.name}`}
								onClick={() => setConfirmingDelete(true)}
							>
								Delete
							</Button>
						)}
					</div>
				</div>
			)}

			{/* The query the Niche stands for, said in a line, so a user knows what opening it will
			    ask without opening it. */}
			<ul className="flex flex-wrap gap-1.5">
				{parts.map((part) => (
					<li
						key={part}
						className="rounded bg-foreground/5 px-1.5 py-0.5 text-[0.7rem] text-muted-foreground"
					>
						{part}
					</li>
				))}
			</ul>
		</div>
	);
}

export function NichesManager({
	niches,
	onOpen,
	onRename,
	onDelete,
}: NichesManagerProps) {
	if (niches === undefined) {
		return <p className="p-4 text-muted-foreground text-xs">Loading Niches…</p>;
	}

	if (niches.length === 0) {
		return (
			<p className="p-4 text-muted-foreground text-xs">
				You have no saved Niches yet. Build a search and save it as a Niche to
				measure that set whenever you come back.
			</p>
		);
	}

	return (
		<div className="flex flex-col">
			{niches.map((niche) => (
				<NicheCard
					key={niche.id}
					niche={niche}
					onOpen={onOpen}
					onRename={onRename}
					onDelete={onDelete}
				/>
			))}
		</div>
	);
}
