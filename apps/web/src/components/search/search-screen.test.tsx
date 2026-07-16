import type { ChannelSearchPage } from "@nichehuntr-v2/backend/convex/search/channels";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import {
	EMPTY_CRITERIA,
	type SearchCriteria,
	toSearchArgs,
} from "@/lib/search/criteria";
import { aChannel, NOW } from "@/testing/channels";

import { SearchScreen } from "./search-screen";

const aPage = (
	overrides: Partial<ChannelSearchPage> = {},
): ChannelSearchPage => ({
	channels: [aChannel()],
	found: 1,
	page: 0,
	pageSize: 20,
	...overrides,
});

/**
 * The screen, driven the way the route drives it: criteria in React state, so a test can type
 * into it and then read back the search the backend would have been asked for.
 */
function Harness({
	results,
	onSearch,
}: {
	results?: ChannelSearchPage;
	onSearch?: (args: ReturnType<typeof toSearchArgs>) => void;
}) {
	const [criteria, setCriteria] = useState<SearchCriteria>(EMPTY_CRITERIA);
	return (
		<SearchScreen
			criteria={criteria}
			onCriteriaChange={(next) => {
				setCriteria(next);
				onSearch?.(toSearchArgs(next));
			}}
			results={results ?? aPage()}
			isSearching={false}
			now={NOW}
		/>
	);
}

/** The last search the screen would have run. */
const lastSearch = (calls: ReturnType<typeof toSearchArgs>[]) =>
	calls[calls.length - 1];

describe("searching by keyword", () => {
	it("searches for what the user typed", async () => {
		const calls: ReturnType<typeof toSearchArgs>[] = [];
		render(<Harness onSearch={(args) => calls.push(args)} />);

		await userEvent.type(
			screen.getByLabelText(/search channels by keyword/i),
			"scary",
		);

		expect(lastSearch(calls)?.keyword).toBe("scary");
	});

	it("tells the user search is free, so nothing makes them hesitate before searching", async () => {
		render(<Harness />);

		expect(screen.getByText(/unlimited and free/i)).toBeInTheDocument();
		expect(screen.getByText(/never costs credits/i)).toBeInTheDocument();
	});
});

describe("filtering", () => {
	it("combines a keyword with several ranges — the canonical query", async () => {
		const calls: ReturnType<typeof toSearchArgs>[] = [];
		render(<Harness onSearch={(args) => calls.push(args)} />);

		await userEvent.type(
			screen.getByLabelText(/search channels by keyword/i),
			"scary stories",
		);
		await userEvent.type(
			screen.getByLabelText(/minimum subscribers/i),
			"10000",
		);
		await userEvent.type(
			screen.getByLabelText(/maximum subscribers/i),
			"200000",
		);
		await userEvent.type(
			screen.getByLabelText(/minimum shorts view share/i),
			"70",
		);
		await userEvent.type(screen.getByLabelText(/minimum momentum/i), "2");

		expect(lastSearch(calls)).toEqual({
			keyword: "scary stories",
			filters: {
				subscriberCount: { min: 10_000, max: 200_000 },
				shortsViewShare: { min: 0.7 },
				momentum: { min: 2 },
			},
			sort: [{ field: "momentum", direction: "desc" }],
			page: 0,
		});
	});

	it("offers a range control for every filter, including the raw stats", async () => {
		render(<Harness />);

		for (const label of [
			/minimum subscribers/i,
			/minimum total views/i,
			/minimum momentum/i,
			/minimum views per subscriber/i,
			/minimum shorts upload share/i,
			/minimum shorts view share/i,
			/minimum upload cadence/i,
			/minimum channel age/i,
		]) {
			expect(screen.getByLabelText(label)).toBeInTheDocument();
		}
	});

	it("clears one filter without disturbing the others", async () => {
		const calls: ReturnType<typeof toSearchArgs>[] = [];
		render(<Harness onSearch={(args) => calls.push(args)} />);

		await userEvent.type(
			screen.getByLabelText(/minimum subscribers/i),
			"10000",
		);
		await userEvent.type(screen.getByLabelText(/minimum momentum/i), "2");

		await userEvent.click(
			screen.getByRole("button", { name: /clear momentum filter/i }),
		);

		expect(lastSearch(calls)?.filters).toEqual({
			subscriberCount: { min: 10_000 },
		});
		expect(screen.getByLabelText(/minimum subscribers/i)).toHaveValue("10000");
		expect(screen.getByLabelText(/minimum momentum/i)).toHaveValue("");
	});

	it("offers to clear a filter only once there is something to clear", async () => {
		render(<Harness />);

		expect(
			screen.queryByRole("button", { name: /clear momentum filter/i }),
		).not.toBeInTheDocument();

		await userEvent.type(screen.getByLabelText(/minimum momentum/i), "2");

		expect(
			screen.getByRole("button", { name: /clear momentum filter/i }),
		).toBeInTheDocument();
	});
});

describe("sorting", () => {
	it("sorts by any Signal, and says what each sort puts first", async () => {
		const calls: ReturnType<typeof toSearchArgs>[] = [];
		render(<Harness onSearch={(args) => calls.push(args)} />);

		await userEvent.selectOptions(
			screen.getByLabelText(/^sort$/i),
			"channelAgeDays:asc",
		);

		expect(lastSearch(calls)?.sort).toEqual([
			{ field: "channelAgeDays", direction: "asc" },
		]);
		expect(
			screen.getByRole("option", { name: "Youngest Channel first" }),
		).toBeInTheDocument();
	});

	it("never offers to sort by raw size", async () => {
		// Raw size ranks Channels by how hard they are to compete with — the opposite of the
		// question being asked — so it is a filter above and not an option here.
		render(<Harness />);

		const sorts = screen
			.getAllByRole("option")
			.map((option) => option.textContent ?? "");
		expect(sorts.some((label) => /subscriber(?!s first)/i.test(label))).toBe(
			true,
		);
		expect(sorts).not.toContain("Most subscribers first");
		expect(sorts).not.toContain("Most total views first");
	});
});

describe("how many Channels matched", () => {
	it("counts the whole match, not the page", async () => {
		// The count is what says how crowded a niche is, which one page could never answer.
		render(
			<Harness
				results={aPage({
					channels: [aChannel(), aChannel({ youtubeChannelId: "UC_two" })],
					found: 137,
					pageSize: 20,
				})}
			/>,
		);

		expect(screen.getByText(/1–2/)).toBeInTheDocument();
		expect(screen.getByText("137")).toBeInTheDocument();
	});

	it("says plainly when nothing matched", async () => {
		render(<Harness results={aPage({ channels: [], found: 0 })} />);

		// Scoped to *our index*, deliberately: an empty result is a fact about what we have
		// looked at, and phrasing it as a fact about YouTube would let our own ignorance read as
		// an uncontested niche.
		expect(
			screen.getByText(/no channels in the index match these criteria/i),
		).toBeInTheDocument();
		expect(screen.getByText("No Channels match")).toBeInTheDocument();
	});
});

describe("paging through the matches", () => {
	it("cannot go back from the first page", async () => {
		render(<Harness results={aPage({ found: 137, page: 0 })} />);

		expect(screen.getByRole("button", { name: /previous/i })).toBeDisabled();
		expect(screen.getByRole("button", { name: /next/i })).toBeEnabled();
	});

	it("asks for the next page when the user pages forward", async () => {
		const calls: ReturnType<typeof toSearchArgs>[] = [];
		render(
			<Harness
				results={aPage({ found: 137, page: 0 })}
				onSearch={(args) => calls.push(args)}
			/>,
		);

		await userEvent.click(screen.getByRole("button", { name: /next/i }));

		expect(lastSearch(calls)?.page).toBe(1);
	});

	it("cannot go past the last page", async () => {
		// Two pages of 20 in a match of 40, paged to the end the way a user gets there.
		render(<Harness results={aPage({ found: 40, page: 0, pageSize: 20 })} />);

		await userEvent.click(screen.getByRole("button", { name: /next/i }));

		expect(screen.getByText(/page 2 of 2/i)).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
	});

	it("keeps advancing while the results on screen are still catching up", async () => {
		// The pager pages from what the user asked for, not from what came back. A search is
		// debounced and the previous page stays on screen while the next loads, so `results.page`
		// lags `criteria.page` for a moment after every click — and a pager reading the stale
		// response would compute `page + 1` from the old page and stick, ignoring the second
		// click. `results` is held fixed here, which is that lag at its worst.
		const calls: ReturnType<typeof toSearchArgs>[] = [];
		render(
			<Harness
				results={aPage({ found: 137, page: 0 })}
				onSearch={(args) => calls.push(args)}
			/>,
		);

		await userEvent.click(screen.getByRole("button", { name: /next/i }));
		await userEvent.click(screen.getByRole("button", { name: /next/i }));

		expect(calls.map((call) => call.page)).toEqual([1, 2]);
	});

	it("counts the page the user asked for, even before its results land", async () => {
		const calls: ReturnType<typeof toSearchArgs>[] = [];
		render(
			<Harness
				results={aPage({ found: 137, page: 0 })}
				onSearch={(args) => calls.push(args)}
			/>,
		);

		await userEvent.click(screen.getByRole("button", { name: /next/i }));

		expect(screen.getByText(/page 2 of 7/i)).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /previous/i })).toBeEnabled();
	});
});

describe("every result row", () => {
	it("shows its Freshness", async () => {
		// The acceptance criterion the index's tiered Refresh forces: a stat without its
		// Freshness is a claim we cannot support, so no row may omit it.
		render(
			<Harness
				results={aPage({
					channels: [
						aChannel({ youtubeChannelId: "UC_one" }),
						aChannel({ youtubeChannelId: "UC_two" }),
					],
					found: 2,
				})}
			/>,
		);

		expect(screen.getAllByText("2 hours ago")).toHaveLength(2);
	});
});

describe("when a search fails", () => {
	it("says so instead of showing an empty niche", async () => {
		// An error rendered as "no results" would read as an uncontested niche, which is the one
		// false answer this product must never give.
		render(
			<SearchScreen
				criteria={EMPTY_CRITERIA}
				onCriteriaChange={() => {}}
				results={undefined}
				isSearching={false}
				error={new Error("the engine is down")}
			/>,
		);

		expect(screen.getByText(/search failed/i)).toBeInTheDocument();
		expect(screen.queryByText(/no channels/i)).not.toBeInTheDocument();
	});
});
