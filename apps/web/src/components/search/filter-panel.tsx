import { Button } from "@nichehuntr-v2/ui/components/button";
import { Input } from "@nichehuntr-v2/ui/components/input";
import { X } from "lucide-react";

import {
	activeFilterFields,
	clearAllFilters,
	clearFilter,
	type FilterField,
	RANGE_FILTERS,
	type RangeFilter,
	type SearchCriteria,
	setBound,
} from "@/lib/search/criteria";

/**
 * The filter panel: a range control per filter, each clearable on its own.
 *
 * Every filter is a *range* with two open ends rather than a preset bucket, because the whole
 * point is to express a specific thesis — "10k to 200k subscribers, over 70% of views from
 * Shorts, Momentum above 2" — and a bucket list is somebody else's thesis. Each control clears
 * by itself so a user can loosen one constraint without rebuilding the query around it.
 *
 * Nothing here spends a Credit. Search is unlimited and free on every plan; Discovery is the
 * metered act, and it is not on this screen.
 */
function RangeControl({
	filter,
	criteria,
	onChange,
}: {
	filter: RangeFilter;
	criteria: SearchCriteria;
	onChange: (next: SearchCriteria) => void;
}) {
	const input = criteria.filters[filter.field] ?? { min: "", max: "" };
	const isActive = input.min.trim() !== "" || input.max.trim() !== "";
	const minId = `${filter.field}-min`;
	const maxId = `${filter.field}-max`;

	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-baseline justify-between gap-2">
				<span className="font-medium text-xs" title={filter.help}>
					{filter.label}
				</span>
				{isActive ? (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="h-5 gap-1 px-1 text-[0.7rem] text-muted-foreground"
						aria-label={`Clear ${filter.label} filter`}
						onClick={() => onChange(clearFilter(criteria, filter.field))}
					>
						<X className="size-3" aria-hidden="true" />
						Clear
					</Button>
				) : null}
			</div>
			<p className="text-[0.7rem] text-muted-foreground leading-snug">
				{filter.help}
			</p>
			<div className="flex items-center gap-1.5">
				<label className="sr-only" htmlFor={minId}>
					{`Minimum ${filter.label} in ${filter.unit}`}
				</label>
				<Input
					id={minId}
					inputMode="decimal"
					placeholder={filter.placeholder.min || "any"}
					value={input.min}
					onChange={(event) =>
						onChange(
							setBound(criteria, filter.field, "min", event.target.value),
						)
					}
				/>
				<span className="text-muted-foreground text-xs">to</span>
				<label className="sr-only" htmlFor={maxId}>
					{`Maximum ${filter.label} in ${filter.unit}`}
				</label>
				<Input
					id={maxId}
					inputMode="decimal"
					placeholder={filter.placeholder.max || "any"}
					value={input.max}
					onChange={(event) =>
						onChange(
							setBound(criteria, filter.field, "max", event.target.value),
						)
					}
				/>
				<span className="w-16 shrink-0 text-[0.7rem] text-muted-foreground">
					{filter.unit}
				</span>
			</div>
		</div>
	);
}

export function FilterPanel({
	criteria,
	onChange,
}: {
	criteria: SearchCriteria;
	onChange: (next: SearchCriteria) => void;
}) {
	const active: FilterField[] = activeFilterFields(criteria);

	return (
		<section
			aria-label="Filters"
			className="flex flex-col gap-4 border-foreground/10 border-r p-4"
		>
			<div className="flex items-center justify-between gap-2">
				<h2 className="font-medium text-sm">Filters</h2>
				{active.length > 0 ? (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="h-6 text-[0.7rem] text-muted-foreground"
						onClick={() => onChange(clearAllFilters(criteria))}
					>
						Clear all
					</Button>
				) : null}
			</div>

			{RANGE_FILTERS.map((filter) => (
				<RangeControl
					key={filter.field}
					filter={filter}
					criteria={criteria}
					onChange={onChange}
				/>
			))}
		</section>
	);
}
