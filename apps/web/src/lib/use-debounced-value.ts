import { useEffect, useState } from "react";

/**
 * A value, settled: it follows `value` but only once that value has stopped changing for
 * `delay`.
 *
 * Search is free at the margin — a self-hosted engine, priced by the box it runs on rather than
 * per query — so this is not here to save money. It is here because a search per keystroke
 * spends the engine's throughput redrawing results for half-typed words nobody read; the user
 * wants the search for "scary stories", not the four searches for "scar", "scary", "scary s"
 * that preceded it. The delay is short enough that searching still feels like thinking.
 */
export function useDebouncedValue<T>(value: T, delay: number): T {
	const [settled, setSettled] = useState(value);

	useEffect(() => {
		const timer = setTimeout(() => setSettled(value), delay);
		return () => clearTimeout(timer);
	}, [value, delay]);

	return settled;
}
