import { api } from "@nichehuntr-v2/backend/convex/_generated/api";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import {
	Authenticated,
	AuthLoading,
	Unauthenticated,
	useMutation,
} from "convex/react";
import { useEffect, useState } from "react";

import SignInForm from "@/components/sign-in-form";
import SignUpForm from "@/components/sign-up-form";

export const Route = createFileRoute("/_auth")({
	component: AuthLayout,
});

/**
 * Grants a new user their starter Niches on their first authenticated moment — here in the shared
 * layout rather than on the Niches route, so it happens whichever page they land on first. Search
 * is the default nav target, so a user could save a query before ever opening Niches; the spec
 * wants their *first* measurement to be of a coherent set, so the starters must already exist by
 * then. Idempotent server-side, so firing it on every session is a no-op after the first.
 */
function ProvisionStarterNiches() {
	const ensureStarters = useMutation(api.niches.manage.ensureStarters);
	useEffect(() => {
		// Fire-and-forget: a failed provision is not worth interrupting the page over, and the next
		// session tries again.
		ensureStarters({}).catch(() => {});
	}, [ensureStarters]);
	return null;
}

function AuthLayout() {
	const [showSignIn, setShowSignIn] = useState(false);

	return (
		<>
			<Authenticated>
				<ProvisionStarterNiches />
				<Outlet />
			</Authenticated>
			<Unauthenticated>
				{showSignIn ? (
					<SignInForm onSwitchToSignUp={() => setShowSignIn(false)} />
				) : (
					<SignUpForm onSwitchToSignIn={() => setShowSignIn(true)} />
				)}
			</Unauthenticated>
			<AuthLoading>
				<div>Loading...</div>
			</AuthLoading>
		</>
	);
}
