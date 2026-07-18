/// <reference types="vite/client" />
/**
 * A user's Niche library: saving the current criteria as a named set, listing them, editing one,
 * deleting one, starting a new user off with good ones — and, the point of the whole thing,
 * re-running a saved Niche against the index *as it is now*.
 *
 * A Niche is per-user and private, so these tests act as named identities (`asUser`) and check
 * not only that a user sees their own Niches but that they cannot see or touch anyone else's.
 * The re-run test drives the real search path with a saved Niche's criteria, so "current, not
 * stored" is proven against a live query rather than asserted about a field.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { aChannel } from "../../testing/channelFixtures";
import { createFakeChannelSource } from "../../testing/fakeChannelSource";
import { createFakeSearchIndex } from "../../testing/fakeSearchIndex";
import { api, internal } from "../_generated/api";
import { setChannelSource } from "../discovery/channelSource";
import schema from "../schema";
import { setSearchIndex } from "../search/searchIndex";
import { type NicheCriteria, STARTER_NICHES } from "./criteria";

const modules = import.meta.glob("/convex/**/*.*s");

const t = () => convexTest(schema, modules);

/**
 * One in-memory backend per test, so acting as two users reads and writes the same database —
 * the only way "user B cannot see user A's Niche" is a real check and not two empty stores.
 */
let convex: ReturnType<typeof t>;
beforeEach(() => {
	convex = t();
});

/** A user, named so a test can act as them and check another user cannot reach their Niches. */
const asUser = (id: string) => convex.withIdentity({ subject: id });

/** A Niche's criteria, with sane defaults so a test states only the part it is about. */
const criteria = (overrides: Partial<NicheCriteria> = {}): NicheCriteria => ({
	keyword: overrides.keyword ?? "",
	filters: overrides.filters ?? {},
	sort: overrides.sort ?? { field: "momentum", direction: "desc" },
});

afterEach(() => {
	setChannelSource(null);
	setSearchIndex(null);
});

describe("saving the current criteria as a Niche", () => {
	it("saves a keyword, its filters and its sort under a name, and lists it back intact", async () => {
		const user = asUser("user-a");
		await user.mutation(api.niches.manage.save, {
			name: "Scary stories, heating up",
			criteria: criteria({
				keyword: "scary stories",
				filters: { subscriberCount: { min: 10_000, max: 200_000 } },
				sort: { field: "momentum", direction: "desc" },
			}),
		});

		const niches = await user.query(api.niches.manage.list, {});

		expect(niches).toHaveLength(1);
		expect(niches[0]).toMatchObject({
			name: "Scary stories, heating up",
			criteria: {
				keyword: "scary stories",
				filters: { subscriberCount: { min: 10_000, max: 200_000 } },
				sort: { field: "momentum", direction: "desc" },
			},
		});
	});

	it("trims the name and refuses a blank one — an unnamed set is one you cannot tell apart", async () => {
		const user = asUser("user-a");

		await user.mutation(api.niches.manage.save, {
			name: "  Cloneable formats  ",
			criteria: criteria(),
		});
		const [saved] = await user.query(api.niches.manage.list, {});
		expect(saved.name).toBe("Cloneable formats");

		await expect(
			user.mutation(api.niches.manage.save, {
				name: "   ",
				criteria: criteria(),
			}),
		).rejects.toThrow(/name/i);
	});

	it("does not let the raw owner key leak into what the client is handed", async () => {
		const user = asUser("user-a");
		await user.mutation(api.niches.manage.save, {
			name: "Anything",
			criteria: criteria(),
		});

		const [saved] = await user.query(api.niches.manage.list, {});
		expect(saved).not.toHaveProperty("owner");
	});
});

describe("editing a Niche", () => {
	it("renames it without disturbing its criteria", async () => {
		const user = asUser("user-a");
		const id = await user.mutation(api.niches.manage.save, {
			name: "Old name",
			criteria: criteria({ keyword: "bonsai" }),
		});

		await user.mutation(api.niches.manage.update, {
			nicheId: id,
			name: "New name",
		});

		const [niche] = await user.query(api.niches.manage.list, {});
		expect(niche.name).toBe("New name");
		expect(niche.criteria.keyword).toBe("bonsai");
	});

	it("refines the criteria — a thesis is edited, not re-typed from scratch", async () => {
		const user = asUser("user-a");
		const id = await user.mutation(api.niches.manage.save, {
			name: "Rising",
			criteria: criteria({ filters: { momentum: { min: 1.5 } } }),
		});

		await user.mutation(api.niches.manage.update, {
			nicheId: id,
			criteria: criteria({
				keyword: "faceless",
				filters: { momentum: { min: 3 } },
				sort: { field: "viewsPerSubscriber", direction: "desc" },
			}),
		});

		const [niche] = await user.query(api.niches.manage.list, {});
		expect(niche.name).toBe("Rising");
		expect(niche.criteria).toMatchObject({
			keyword: "faceless",
			filters: { momentum: { min: 3 } },
			sort: { field: "viewsPerSubscriber", direction: "desc" },
		});
	});
});

describe("deleting a Niche", () => {
	it("removes it from the list", async () => {
		const user = asUser("user-a");
		const id = await user.mutation(api.niches.manage.save, {
			name: "Doomed",
			criteria: criteria(),
		});

		await user.mutation(api.niches.manage.remove, { nicheId: id });

		expect(await user.query(api.niches.manage.list, {})).toHaveLength(0);
	});
});

describe("a Niche is per-user and private", () => {
	it("shows each user only their own Niches", async () => {
		await asUser("user-a").mutation(api.niches.manage.save, {
			name: "A's niche",
			criteria: criteria(),
		});
		await asUser("user-b").mutation(api.niches.manage.save, {
			name: "B's niche",
			criteria: criteria(),
		});

		const aNiches = await asUser("user-a").query(api.niches.manage.list, {});
		const bNiches = await asUser("user-b").query(api.niches.manage.list, {});
		expect(aNiches.map((n) => n.name)).toEqual(["A's niche"]);
		expect(bNiches.map((n) => n.name)).toEqual(["B's niche"]);
	});

	it("will not let one user edit or delete another's Niche, nor even confirm it exists", async () => {
		const id = await asUser("user-a").mutation(api.niches.manage.save, {
			name: "A's private niche",
			criteria: criteria(),
		});

		// Same error for "not yours" as for "no such Niche": telling them apart would confirm
		// another user holds a Niche with this id.
		await expect(
			asUser("user-b").mutation(api.niches.manage.update, {
				nicheId: id,
				name: "hijacked",
			}),
		).rejects.toThrow(/no such niche/i);
		await expect(
			asUser("user-b").mutation(api.niches.manage.remove, { nicheId: id }),
		).rejects.toThrow(/no such niche/i);

		// And A's Niche is untouched.
		const [niche] = await asUser("user-a").query(api.niches.manage.list, {});
		expect(niche.name).toBe("A's private niche");
	});

	it("refuses every operation to a caller who is not signed in", async () => {
		const anon = convex;
		await expect(anon.query(api.niches.manage.list, {})).rejects.toThrow(
			/signed in/i,
		);
		await expect(
			anon.mutation(api.niches.manage.save, {
				name: "x",
				criteria: criteria(),
			}),
		).rejects.toThrow(/signed in/i);
		await expect(
			anon.mutation(api.niches.manage.ensureStarters, {}),
		).rejects.toThrow(/signed in/i);
	});
});

describe("starter Niches for a new user", () => {
	it("grants a new user the whole starter set", async () => {
		const user = asUser("newcomer");

		await user.mutation(api.niches.manage.ensureStarters, {});

		const niches = await user.query(api.niches.manage.list, {});
		expect(niches.map((n) => n.name).sort()).toEqual(
			STARTER_NICHES.map((s) => s.name).sort(),
		);
	});

	it("grants them once — a second call adds nothing", async () => {
		const user = asUser("newcomer");

		await user.mutation(api.niches.manage.ensureStarters, {});
		await user.mutation(api.niches.manage.ensureStarters, {});

		expect(await user.query(api.niches.manage.list, {})).toHaveLength(
			STARTER_NICHES.length,
		);
	});

	it("does not push starters back at a user who deleted theirs on purpose", async () => {
		const user = asUser("newcomer");
		await user.mutation(api.niches.manage.ensureStarters, {});
		const niches = await user.query(api.niches.manage.list, {});
		for (const niche of niches) {
			await user.mutation(api.niches.manage.remove, { nicheId: niche.id });
		}

		// A cleared slate is a choice, not a new user: the grant already happened.
		await user.mutation(api.niches.manage.ensureStarters, {});

		expect(await user.query(api.niches.manage.list, {})).toHaveLength(0);
	});

	it("gives each user their own starters, not a shared set", async () => {
		await asUser("first").mutation(api.niches.manage.ensureStarters, {});
		await asUser("second").mutation(api.niches.manage.ensureStarters, {});

		expect(
			await asUser("second").query(api.niches.manage.list, {}),
		).toHaveLength(STARTER_NICHES.length);
	});
});

describe("re-running a Niche returns current results, not stored ones", () => {
	it("measures the index as it is at re-run, including Channels indexed after the Niche was saved", async () => {
		// The engine and the source, shared by the ingest that seeds the index and the search
		// that re-runs the Niche against it.
		const source = createFakeChannelSource([
			aChannel({ youtubeChannelId: "UC_first", title: "cooking first" }),
			aChannel({ youtubeChannelId: "UC_second", title: "cooking second" }),
		]);
		setChannelSource(source);
		setSearchIndex(createFakeSearchIndex());
		const convex = convexTest(schema, modules);
		const user = convex.withIdentity({ subject: "chef" });

		// One Channel is in the index when the Niche is saved.
		await convex.action(internal.ingestion.ingestChannel, {
			youtubeChannelId: "UC_first",
		});
		await user.mutation(api.niches.manage.save, {
			name: "Cooking",
			criteria: criteria({ keyword: "cooking" }),
		});

		// A second matching Channel is indexed *after* the Niche was saved.
		await convex.action(internal.ingestion.ingestChannel, {
			youtubeChannelId: "UC_second",
		});

		// Re-running the Niche is running search with its stored criteria — and it sees both.
		const [niche] = await user.query(api.niches.manage.list, {});
		const results = await convex.action(api.search.channels.searchChannels, {
			keyword: niche.criteria.keyword,
			filters: niche.criteria.filters,
			sort: [niche.criteria.sort],
		});

		expect(results.found).toBe(2);
		expect(results.channels.map((c) => c.youtubeChannelId).sort()).toEqual([
			"UC_first",
			"UC_second",
		]);
	});
});
