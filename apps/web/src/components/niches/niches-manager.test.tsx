import type { SavedNiche } from "@nichehuntr-v2/backend/convex/niches/manage";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { NichesManager } from "./niches-manager";

/** A saved Niche as the list read hands it back, with defaults so a test states only its point. */
const aNiche = (overrides: Partial<SavedNiche> = {}): SavedNiche => ({
	id: "niche_1" as SavedNiche["id"],
	name: "Scary stories, heating up",
	createdAt: 0,
	criteria: {
		keyword: "scary stories",
		filters: { momentum: { min: 2 } },
		sort: { field: "momentum", direction: "desc" },
	},
	...overrides,
});

describe("showing the library", () => {
	it("tells loading apart from an empty library — a new user has not cleared anything", () => {
		const { rerender } = render(
			<NichesManager
				niches={undefined}
				onOpen={() => {}}
				onRename={() => {}}
				onDelete={() => {}}
			/>,
		);
		expect(screen.getByText(/loading niches/i)).toBeInTheDocument();

		rerender(
			<NichesManager
				niches={[]}
				onOpen={() => {}}
				onRename={() => {}}
				onDelete={() => {}}
			/>,
		);
		expect(screen.getByText(/no saved niches yet/i)).toBeInTheDocument();
	});

	it("shows each Niche with the query it stands for, so opening it holds no surprises", () => {
		render(
			<NichesManager
				niches={[aNiche()]}
				onOpen={() => {}}
				onRename={() => {}}
				onDelete={() => {}}
			/>,
		);

		expect(screen.getByText("Scary stories, heating up")).toBeInTheDocument();
		expect(screen.getByText("“scary stories”")).toBeInTheDocument();
		expect(screen.getByText("Momentum: ≥ 2×")).toBeInTheDocument();
		expect(
			screen.getByText("Sorted: Heating up fastest first"),
		).toBeInTheDocument();
	});
});

describe("opening a Niche", () => {
	it("hands the whole Niche back so the parent can re-run its current results", async () => {
		const onOpen = vi.fn();
		const niche = aNiche();
		render(
			<NichesManager
				niches={[niche]}
				onOpen={onOpen}
				onRename={() => {}}
				onDelete={() => {}}
			/>,
		);

		await userEvent.click(
			screen.getByRole("button", { name: /open scary stories/i }),
		);

		expect(onOpen).toHaveBeenCalledWith(niche);
	});
});

describe("renaming a Niche", () => {
	it("saves the new name and never touches the criteria", async () => {
		const onRename = vi.fn();
		const niche = aNiche();
		render(
			<NichesManager
				niches={[niche]}
				onOpen={() => {}}
				onRename={onRename}
				onDelete={() => {}}
			/>,
		);

		await userEvent.click(
			screen.getByRole("button", { name: /rename scary stories/i }),
		);
		const box = screen.getByLabelText(/rename scary stories/i);
		await userEvent.clear(box);
		await userEvent.type(box, "Rising faceless");
		await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

		expect(onRename).toHaveBeenCalledWith(niche, "Rising faceless");
	});

	it("will not save a blank name", async () => {
		const onRename = vi.fn();
		render(
			<NichesManager
				niches={[aNiche()]}
				onOpen={() => {}}
				onRename={onRename}
				onDelete={() => {}}
			/>,
		);

		await userEvent.click(
			screen.getByRole("button", { name: /rename scary stories/i }),
		);
		await userEvent.clear(screen.getByLabelText(/rename scary stories/i));

		expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
		expect(onRename).not.toHaveBeenCalled();
	});
});

describe("deleting a Niche", () => {
	it("asks before deleting — a destructive click is not a delete", async () => {
		const onDelete = vi.fn();
		render(
			<NichesManager
				niches={[aNiche()]}
				onOpen={() => {}}
				onRename={() => {}}
				onDelete={onDelete}
			/>,
		);

		await userEvent.click(
			screen.getByRole("button", { name: /^delete scary stories/i }),
		);
		// Nothing is deleted on the first click; it asks to confirm.
		expect(onDelete).not.toHaveBeenCalled();

		await userEvent.click(
			screen.getByRole("button", { name: /confirm delete scary stories/i }),
		);
		expect(onDelete).toHaveBeenCalledWith(aNiche());
	});

	it("lets the user back out of a delete", async () => {
		const onDelete = vi.fn();
		render(
			<NichesManager
				niches={[aNiche()]}
				onOpen={() => {}}
				onRename={() => {}}
				onDelete={onDelete}
			/>,
		);

		await userEvent.click(
			screen.getByRole("button", { name: /^delete scary stories/i }),
		);
		await userEvent.click(screen.getByRole("button", { name: /keep/i }));

		expect(onDelete).not.toHaveBeenCalled();
		// And the plain Delete affordance is back.
		expect(
			screen.getByRole("button", { name: /^delete scary stories/i }),
		).toBeInTheDocument();
	});
});
