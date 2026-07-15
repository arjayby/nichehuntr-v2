# Typesense is the search engine

## Status

accepted

## Context

ADR-0001 decided that Channel search runs against an external engine holding a projection of
Channel documents, and that the engine must be **self-hostable and not priced per search** —
search sits underneath a credit-based pricing model and users search constantly, so a variable
per-search fee would put an uncontrolled cost directly under our margin. It named Typesense and
Meilisearch as candidates without choosing between them.

Building the projection and the keyword search forces the choice: the `SearchIndex` port needs a
concrete engine behind it, and the in-memory fake the test suite runs against has to mirror that
engine's semantics — inclusive numeric ranges, multi-field sort, and where a *missing* value
lands in a sort — or the suite would be certifying behaviour production does not have.

Both candidates are self-hostable and neither charges per search, so both satisfy the ADR-0001
constraint. They differ on the semantics the fake has to match:

- **Typesense** exposes multi-field `sort_by` with explicit per-field control over where missing
  values sort (`missing_values: first | last`), which is exactly the "an absent Growth must not
  sort below a declining Channel" rule the projection has to honour. Its filtering language takes
  inclusive numeric ranges directly.
- **Meilisearch** is comparable on keyword search and faceting, but its handling of missing
  values in a sort is less directly controllable, which is the one semantic the fake most needs
  to reproduce faithfully.

## Decision

**Channel search runs on self-hosted Typesense.** The `SearchIndex` port has one real
implementation, `createTypesenseSearchIndex`, which translates the port into Typesense's HTTP
API; the in-memory fake reproduces the same semantics so the suite tests the search production
runs.

A missing numeric value sorts to the **favourable end** of whichever direction is asked for —
`missing_values: first` on a descending sort, `last` on an ascending one — so an unmeasured
Channel never sorts below one the index has watched decline. The fake mirrors this by comparing
an absent value as `+Infinity`.

## Consequences

- **No per-search fee.** Typesense is priced by the box it runs on, not by query volume, so
  search stays effectively free at the margin however hard a user explores — the property the
  credit model depends on.
- **We run a search box.** Self-hosting is operational surface we now own: a Typesense node, its
  capacity, and its availability. Because the projection is derived and rebuildable from Convex
  (ADR-0001), that node holds no ground truth — it can be wiped and rebuilt — but it still has to
  be *up* for search to answer.
- **The fake is pinned to Typesense's semantics.** The two must not drift: the fake's range,
  sort, and missing-value behaviour is a deliberate mirror of Typesense, and a change to one is a
  change to both. Migrating engines later means re-checking every semantic the fake encodes.
