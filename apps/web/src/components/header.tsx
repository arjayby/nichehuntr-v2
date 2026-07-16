import { Link } from "@tanstack/react-router";

export default function Header() {
	const links = [
		{ to: "/", label: "Home" },
		// "Search", not "Discover": Discovery is the metered act of going out to YouTube for what
		// we have not indexed (see ADR-0002). Searching the index we already have is free, and a
		// label that called it Discovery would price it in the user's head.
		{ to: "/search", label: "Search" },
		{ to: "/dashboard", label: "Dashboard" },
	] as const;

	return (
		<div>
			<div className="flex flex-row items-center justify-between px-2 py-1">
				<nav className="flex gap-4 text-lg">
					{links.map(({ to, label }) => {
						return (
							<Link key={to} to={to}>
								{label}
							</Link>
						);
					})}
				</nav>
				<div className="flex items-center gap-2" />
			</div>
			<hr />
		</div>
	);
}
