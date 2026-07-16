import type { ChannelSearchPage } from "@nichehuntr-v2/backend/convex/search/channels";
import { Button } from "@nichehuntr-v2/ui/components/button";
import { Input } from "@nichehuntr-v2/ui/components/input";

import {
	goToPage,
	type SearchCriteria,
	SORT_OPTIONS,
	setKeyword,
	setSort,
} from "@/lib/search/criteria";

import { ChannelRow } from "./channel-row";
import { FilterPanel } from "./filter-panel";

/**
 * The Channel search screen: a keyword box, the filters, a sorted list of Channels, the match
 * count and a pager.
 *
 * Named for what it does, not for the product area it sits in. The PRD brands this half of the
 * product "Discovery", but CONTEXT.md gives that word to one specific act — going out to YouTube
 * for Channels we have not indexed — and that act is metered in Credits while this screen is
 * free (ADR-0002). Searching the index we already have is not Discovery, so nothing here is
 * called Discovery.
 *
 * Presentational and complete — it takes the criteria, the page of results and a callback, and
 * knows nothing about how a search is run. The route above it does the fetching. That split is
 * what lets the whole screen be tested for what it actually promises (a count, a Freshness on
 * every row, a filter that clears on its own) without a network in the way.
 *
 * Nothing on this screen costs a Credit, and nothing on it should make a user hesitate before
 * searching: exploring the index is the entire activity, and metering it would kill the product
 * to save the Crawl Budget.
 */
export type SearchScreenProps = {
	criteria: SearchCriteria;
	onCriteriaChange: (next: SearchCriteria) => void;
	results: ChannelSearchPage | undefined;
	isSearching: boolean;
	error?: Error | null;
	/** The clock, for Freshness. Tests pass one; the app lets it default to now. */
	now?: number;
};

/**
 * "1–20 of 137 Channels" — how many Channels the criteria matched, which is the number that says
 * how crowded a niche is and which one page could never answer.
 *
 * Counted off `results`, not off the criteria: this sentence describes the rows actually on
 * screen, and during a search those are still the previous page's. Labelling stale rows with the
 * page the user has just asked for would be the one wrong answer here.
 */
function MatchCount({ results }: { results: ChannelSearchPage }) {
	const { found, page, pageSize, channels } = results;
	if (found === 0 || channels.length === 0) {
		return <span>No Channels match</span>;
	}
	const first = page * pageSize + 1;
	const last = page * pageSize + channels.length;
	return (
		<span>
			<span className="text-foreground tabular-nums">
				{first.toLocaleString()}–{last.toLocaleString()}
			</span>{" "}
			of{" "}
			<span className="text-foreground tabular-nums">
				{found.toLocaleString()}
			</span>{" "}
			{found === 1 ? "Channel" : "Channels"}
		</span>
	);
}

/**
 * The pager.
 *
 * The page it is on is `criteria.page` — what the user asked for — and never `results.page`.
 * Searches are debounced and the previous page stays on screen while the next loads, so the
 * results lag the criteria for a moment after every click. A pager that computed `page + 1` off
 * the lagging response would answer a second click with the same page it just asked for, and
 * paging quickly would quietly stall.
 *
 * How many pages there *are* still comes from `results`: only the search knows what matched.
 */
function Pagination({
	results,
	criteria,
	onCriteriaChange,
}: {
	results: ChannelSearchPage;
	criteria: SearchCriteria;
	onCriteriaChange: (next: SearchCriteria) => void;
}) {
	const { found, pageSize } = results;
	const page = criteria.page;
	const lastPage = Math.max(0, Math.ceil(found / pageSize) - 1);

	return (
		<nav aria-label="Pagination" className="flex items-center gap-2">
			<Button
				type="button"
				variant="outline"
				size="sm"
				disabled={page <= 0}
				onClick={() => onCriteriaChange(goToPage(criteria, page - 1))}
			>
				Previous
			</Button>
			<span className="text-muted-foreground text-xs tabular-nums">
				Page {page + 1} of {lastPage + 1}
			</span>
			<Button
				type="button"
				variant="outline"
				size="sm"
				disabled={page >= lastPage}
				onClick={() => onCriteriaChange(goToPage(criteria, page + 1))}
			>
				Next
			</Button>
		</nav>
	);
}

export function SearchScreen({
	criteria,
	onCriteriaChange,
	results,
	isSearching,
	error,
	now,
}: SearchScreenProps) {
	return (
		<div className="grid grid-cols-1 overflow-y-auto md:grid-cols-[20rem_1fr]">
			<FilterPanel criteria={criteria} onChange={onCriteriaChange} />

			<main className="flex min-w-0 flex-col">
				<div className="flex flex-col gap-3 border-foreground/10 border-b p-4">
					<div>
						<label className="sr-only" htmlFor="keyword">
							Search Channels by keyword
						</label>
						<Input
							id="keyword"
							type="search"
							className="h-9 text-sm"
							placeholder="scary stories"
							value={criteria.keyword}
							onChange={(event) =>
								onCriteriaChange(setKeyword(criteria, event.target.value))
							}
						/>
						{/* Said out loud, because a user who hesitates before searching has stopped
						    hunting — and exploring the index is the entire activity. */}
						<p className="mt-1 text-[0.7rem] text-muted-foreground">
							Matches a Channel's title, description and its Videos' titles.
							Search is unlimited and free — it never costs Credits.
						</p>
					</div>

					<div className="flex flex-wrap items-center justify-between gap-3">
						<div className="text-muted-foreground text-xs">
							{error ? (
								<span className="text-destructive">
									Search failed: {error.message}
								</span>
							) : results === undefined ? (
								<span>Searching…</span>
							) : (
								<MatchCount results={results} />
							)}
						</div>

						<div className="flex items-center gap-2">
							<label className="text-muted-foreground text-xs" htmlFor="sort">
								Sort
							</label>
							<select
								id="sort"
								className="h-8 border border-input bg-transparent px-2 text-xs"
								value={criteria.sortId}
								onChange={(event) =>
									onCriteriaChange(setSort(criteria, event.target.value))
								}
							>
								{SORT_OPTIONS.map((option) => (
									<option key={option.id} value={option.id}>
										{option.label}
									</option>
								))}
							</select>
						</div>
					</div>
				</div>

				<div
					aria-busy={isSearching}
					className={isSearching ? "opacity-60 transition-opacity" : undefined}
				>
					{results?.channels.map((channel) => (
						<ChannelRow
							key={channel.youtubeChannelId}
							channel={channel}
							now={now}
						/>
					))}
				</div>

				{results && results.found === 0 && !isSearching ? (
					<p className="p-8 text-center text-muted-foreground text-xs">
						No Channels in the index match these criteria.
					</p>
				) : null}

				{results && results.found > 0 ? (
					<div className="flex justify-center border-foreground/10 border-t p-4">
						<Pagination
							results={results}
							criteria={criteria}
							onCriteriaChange={onCriteriaChange}
						/>
					</div>
				) : null}
			</main>
		</div>
	);
}
