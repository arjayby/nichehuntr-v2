import { Button } from "@nichehuntr-v2/ui/components/button";
import { Input } from "@nichehuntr-v2/ui/components/input";
import { useState } from "react";

/**
 * "Save as Niche": the one control that turns the search a user has built into a named, saved
 * set. Closed it is a single button; opened it is a name box and a confirm, because a Niche
 * without a name is a set the user cannot tell from their others — the name is the whole point.
 *
 * Presentational and complete. It knows how to collect a name and nothing about what saving a
 * Niche does; the screen above it hands over an `onSave` that stores the *current* criteria. That
 * split is what lets the control be tested for what it promises — a blank name cannot be saved,
 * a saved name is trimmed — without a Convex mutation in the way.
 */
export type SaveNicheControlProps = {
	/** Called with the trimmed name when the user confirms. The parent stores the criteria. */
	onSave: (name: string) => void;
	/** True while a save is in flight, so the confirm cannot be double-fired. */
	saving?: boolean;
};

export function SaveNicheControl({ onSave, saving }: SaveNicheControlProps) {
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const trimmed = name.trim();

	const close = () => {
		setName("");
		setOpen(false);
	};

	if (!open) {
		return (
			<Button
				type="button"
				variant="outline"
				size="sm"
				onClick={() => setOpen(true)}
			>
				Save as Niche
			</Button>
		);
	}

	return (
		<form
			className="flex items-center gap-2"
			onSubmit={(event) => {
				event.preventDefault();
				// A blank name is not a Niche. The button is disabled too; this guards the Enter key.
				if (trimmed === "") {
					return;
				}
				onSave(trimmed);
				close();
			}}
		>
			<label className="sr-only" htmlFor="niche-name">
				Name this Niche
			</label>
			<Input
				id="niche-name"
				// The control only exists once the user asked to name a Niche, so focus belongs here.
				autoFocus
				className="h-8 text-xs"
				placeholder="Name this Niche"
				value={name}
				onChange={(event) => setName(event.target.value)}
			/>
			<Button type="submit" size="sm" disabled={trimmed === "" || saving}>
				Save
			</Button>
			<Button type="button" variant="ghost" size="sm" onClick={close}>
				Cancel
			</Button>
		</form>
	);
}
