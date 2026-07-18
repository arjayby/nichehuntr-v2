import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SaveNicheControl } from "./save-niche-control";

describe("saving the current search as a Niche", () => {
	it("only asks for a name once the user chooses to save", async () => {
		render(<SaveNicheControl onSave={() => {}} />);

		// Closed, it is one button and no box to fill in unprompted.
		expect(screen.queryByLabelText(/name this niche/i)).not.toBeInTheDocument();

		await userEvent.click(
			screen.getByRole("button", { name: /save as niche/i }),
		);

		expect(screen.getByLabelText(/name this niche/i)).toBeInTheDocument();
	});

	it("saves under the trimmed name", async () => {
		const onSave = vi.fn();
		render(<SaveNicheControl onSave={onSave} />);

		await userEvent.click(
			screen.getByRole("button", { name: /save as niche/i }),
		);
		await userEvent.type(
			screen.getByLabelText(/name this niche/i),
			"  Cloneable formats  ",
		);
		await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

		expect(onSave).toHaveBeenCalledWith("Cloneable formats");
	});

	it("cannot save a Niche with no name", async () => {
		const onSave = vi.fn();
		render(<SaveNicheControl onSave={onSave} />);

		await userEvent.click(
			screen.getByRole("button", { name: /save as niche/i }),
		);

		// A nameless Niche is one you cannot tell from your others, so Save stays disabled.
		expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
		await userEvent.type(screen.getByLabelText(/name this niche/i), "   ");
		expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
		expect(onSave).not.toHaveBeenCalled();
	});

	it("lets the user back out without saving", async () => {
		const onSave = vi.fn();
		render(<SaveNicheControl onSave={onSave} />);

		await userEvent.click(
			screen.getByRole("button", { name: /save as niche/i }),
		);
		await userEvent.type(
			screen.getByLabelText(/name this niche/i),
			"Never mind",
		);
		await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

		expect(onSave).not.toHaveBeenCalled();
		// Back to the single button, with nothing half-typed left behind.
		expect(
			screen.getByRole("button", { name: /save as niche/i }),
		).toBeInTheDocument();
		expect(screen.queryByLabelText(/name this niche/i)).not.toBeInTheDocument();
	});
});
