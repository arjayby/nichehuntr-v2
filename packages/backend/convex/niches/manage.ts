/**
 * A user's Niche library: save the current search criteria as a named Niche, list them, edit
 * one, delete one, and provision a new user with good starters.
 *
 * These are Convex queries and mutations, not search: a Niche stores *criteria*, which are flat
 * documents Convex holds and can enforce ownership over. Re-running a Niche — going back out to
 * the engine for its current results — happens on the search path (`searchChannels`) with the
 * criteria read from here; nothing in this module returns Channels, because a Niche is a living
 * view of the index and never a snapshot of it (CONTEXT.md, "Niche").
 *
 * Every function is scoped to the caller. `owner` is derived server-side from the authenticated
 * identity and never accepted as an argument, so a Niche is private by construction: one user
 * can neither read nor write another's, and a mutation naming a Niche it does not own is answered
 * as if that Niche did not exist.
 */
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import {
	type MutationCtx,
	mutation,
	type QueryCtx,
	query,
} from "../_generated/server";
import {
	type NicheCriteria,
	nicheCriteriaValidator,
	STARTER_NICHES,
} from "./criteria";

/** The longest a Niche name may be — enough for a sentence, short of an essay. */
const MAX_NAME_LENGTH = 100;

/**
 * The most Niches one user may hold. A Niche is cheap, but the list is read whole on every
 * visit, so it is bounded — and a user with hundreds of saved queries has a different problem
 * than this screen solves. Far above what anyone reaches by hand; it exists to keep the read
 * bounded, not to ration a scarce thing.
 */
const MAX_NICHES_PER_USER = 200;

/**
 * A saved Niche as the client sees it: its id, its name, when it was saved, and the criteria to
 * re-run or edit. Deliberately *not* the raw row — `owner` is the caller's own identity key and
 * stays server-side, the same discipline the Channel detail read keeps in naming a product
 * surface rather than handing the stored document out whole.
 */
export type SavedNiche = {
	id: Id<"niches">;
	name: string;
	/** When the Niche was first saved, for a stable, meaningful order in the list. */
	createdAt: number;
	criteria: NicheCriteria;
};

/**
 * The authenticated caller's stable identity, or an error. `tokenIdentifier` rather than
 * `subject`: it folds in the issuer, so it stays unique even if a second auth provider is ever
 * added, and it is the key every Niche is owned by. Derived here, never taken as an argument —
 * an ownership check a caller could hand its own answer to would not be one.
 */
async function requireOwner(ctx: QueryCtx | MutationCtx): Promise<string> {
	const identity = await ctx.auth.getUserIdentity();
	if (identity === null) {
		throw new Error("You must be signed in to use Niches");
	}
	return identity.tokenIdentifier;
}

/**
 * A name trimmed and checked, or an error. A blank name is rejected rather than defaulted:
 * an unnamed Niche is a set the user cannot tell apart from their others, which defeats the
 * one thing a Niche adds over a raw query.
 */
function cleanName(name: string): string {
	const trimmed = name.trim();
	if (trimmed === "") {
		throw new Error("A Niche needs a name");
	}
	if (trimmed.length > MAX_NAME_LENGTH) {
		throw new Error(
			`A Niche name may be at most ${MAX_NAME_LENGTH} characters`,
		);
	}
	return trimmed;
}

/** The Niche the caller owns by this id, or an error that does not say which of the two it was. */
async function ownedNiche(
	ctx: MutationCtx,
	owner: string,
	nicheId: Id<"niches">,
) {
	const niche = await ctx.db.get(nicheId);
	// One error for "no such Niche" and "not yours": telling them apart would leak that a Niche
	// with this id exists at all, which is a fact about another user's library.
	if (niche === null || niche.owner !== owner) {
		throw new Error("No such Niche");
	}
	return niche;
}

/**
 * The caller's Niches, newest first.
 *
 * Bounded by `MAX_NICHES_PER_USER` off the owner index, not collected whole: the list is read
 * on every visit and a query that grows without limit as a user saves more is a slow read
 * waiting to happen. Ordered by creation so the list does not reshuffle as Niches are edited.
 */
export const list = query({
	args: {},
	handler: async (ctx): Promise<SavedNiche[]> => {
		const owner = await requireOwner(ctx);
		const rows = await ctx.db
			.query("niches")
			.withIndex("by_owner", (q) => q.eq("owner", owner))
			.order("desc")
			.take(MAX_NICHES_PER_USER);
		return rows.map((niche) => ({
			id: niche._id,
			name: niche.name,
			createdAt: niche._creationTime,
			criteria: niche.criteria,
		}));
	},
});

/**
 * Saves the current search criteria as a named Niche, and returns its id.
 *
 * Stores the criteria, never any results: what makes this a Niche and not a bookmark is that
 * re-running it later measures the index *as it is then*. Capped per user so the list read
 * stays bounded.
 */
export const save = mutation({
	args: { name: v.string(), criteria: nicheCriteriaValidator },
	handler: async (ctx, { name, criteria }): Promise<Id<"niches">> => {
		const owner = await requireOwner(ctx);
		const cleaned = cleanName(name);

		// One over the cap is enough to know the cap is exceeded, and reads no more than it must.
		const held = await ctx.db
			.query("niches")
			.withIndex("by_owner", (q) => q.eq("owner", owner))
			.take(MAX_NICHES_PER_USER + 1);
		if (held.length >= MAX_NICHES_PER_USER) {
			throw new Error(
				`You can save up to ${MAX_NICHES_PER_USER} Niches; delete one to make room`,
			);
		}

		return await ctx.db.insert("niches", { owner, name: cleaned, criteria });
	},
});

/**
 * Edits a Niche's name, its criteria, or both — whichever is given.
 *
 * Editing the criteria is the point of a Niche being a saved *query*: a thesis is refined, not
 * re-typed from scratch, and the same set keeps its name and its history of appearing in the
 * list. An edit to a Niche the caller does not own is refused as a missing Niche.
 */
export const update = mutation({
	args: {
		nicheId: v.id("niches"),
		name: v.optional(v.string()),
		criteria: v.optional(nicheCriteriaValidator),
	},
	handler: async (ctx, { nicheId, name, criteria }): Promise<null> => {
		const owner = await requireOwner(ctx);
		await ownedNiche(ctx, owner, nicheId);
		await ctx.db.patch(nicheId, {
			...(name === undefined ? {} : { name: cleanName(name) }),
			...(criteria === undefined ? {} : { criteria }),
		});
		return null;
	},
});

/** Deletes one of the caller's Niches. A Niche the caller does not own is refused as missing. */
export const remove = mutation({
	args: { nicheId: v.id("niches") },
	handler: async (ctx, { nicheId }): Promise<null> => {
		const owner = await requireOwner(ctx);
		await ownedNiche(ctx, owner, nicheId);
		await ctx.db.delete(nicheId);
		return null;
	},
});

/**
 * Grants the caller their starter Niches, once.
 *
 * A new user's first measurements should be of coherent sets, not of an incoherent query they
 * invented in ten seconds — so they start with good Niches (CONTEXT.md, "Niche"). The gift is
 * recorded, not inferred from an empty list: a user who has cleared their Niches on purpose is
 * not a new user, and must not have starters pushed back at them. Idempotent — a second call,
 * or a concurrent one, is a no-op.
 */
export const ensureStarters = mutation({
	args: {},
	handler: async (ctx): Promise<null> => {
		const owner = await requireOwner(ctx);
		const granted = await ctx.db
			.query("nicheStarterGrants")
			.withIndex("by_owner", (q) => q.eq("owner", owner))
			.unique();
		if (granted !== null) {
			return null;
		}
		await ctx.db.insert("nicheStarterGrants", { owner });
		for (const starter of STARTER_NICHES) {
			await ctx.db.insert("niches", {
				owner,
				name: starter.name,
				criteria: starter.criteria,
			});
		}
		return null;
	},
});
