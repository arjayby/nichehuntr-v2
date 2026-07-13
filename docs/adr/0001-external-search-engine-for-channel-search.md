# External search engine for Channel search

## Status

accepted

## Context

The canonical query of this product combines full-text keywords, **several simultaneous numeric
ranges** (subscribers, form share, momentum), and an **arbitrary sort** (e.g. by momentum), with
pagination.

Convex cannot express this:

- A Convex `searchIndex` has exactly one `searchField`, its `filterFields` are **equality-only**
  (no ranges), and results come back in **relevance order** with no way to re-sort by another field.
- A standard Convex index supports a range on its **last field only**, forces the sort to that
  index's order, and offers no full-text.
- Filtering in memory is not an escape: sorting a large keyword-matched candidate set by momentum
  would mean loading every matching document into a function on every query.

Search quality *is* the product — it is the entire difference between us and a spreadsheet — so
reshaping the product to fit the datastore (bucketing ranges into equality facets, dropping
sort-by-momentum) was rejected as amputating the thing customers pay for.

## Decision

Convex remains the **system of record** (Channels, Channel Snapshots, Niches, users, credits, all
writes). A dedicated search engine holds a **projection** of Channel documents and serves user-facing
search: facets, numeric ranges, multi-field sort, pagination, typo tolerance.

Refresh writes to Convex; the projection is synced from it. The projection is derived data and can
always be rebuilt from Convex.

We prefer a self-hostable, non-per-search-priced engine (e.g. Typesense/Meilisearch) over
per-search-priced hosted search (e.g. Algolia): users search constantly and search sits underneath a
credit-based pricing model, so a variable per-search cost would put an uncontrolled variable cost
directly under our margin. **Search must be effectively free at the margin.**

## Consequences

- Two datastores and a sync pipeline. Convex and the projection are **eventually consistent**; a
  just-refreshed Channel may briefly be stale in search results.
- **We lose Convex's live reactivity on search results.** A result list cannot simply auto-fill as
  the crawler lands new rows; refreshing results during demand-driven Discovery requires an explicit
  refetch (e.g. a signal in Convex that the client watches, triggering a re-query).
- The projection's schema is a product surface: adding a new filter or sort means changing what is
  projected, not just what is stored.
