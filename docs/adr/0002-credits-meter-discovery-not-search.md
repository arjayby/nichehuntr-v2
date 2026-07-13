# Credits meter Discovery, not search

## Status

accepted

## Context

Searching our own index is effectively free at the margin (see ADR-0001). **Discovery** — going out
to YouTube to find Channels we don't have — spends Crawl Budget, which is our scarcest resource and
our real cost of goods.

Left unmetered, a single user exploring unusual niches could exhaust a day's Crawl Budget through
ordinary use, degrading Freshness for every paying user. The users who cost the most are exactly the
ones exploring hardest — our best users would be our most expensive.

Metering *search* was rejected: search must feel free or users stop exploring, and exploration is the
entire activity. A user who hesitates before searching has stopped hunting.

## Decision

**Search is unlimited and free on every plan. Discovery is the metered, credit-consuming act.**

When a query hits thin [Coverage], we do not silently spend budget. We surface it as an explicit,
user-initiated offer — *"nobody has looked here yet; expand coverage for this niche?"* — priced in
credits.

## Consequences

- **Credits are denominated in the thing that actually costs us money.** COGS and revenue share a
  unit; the credit system is real rather than a fiction bolted onto a flat cost base.
- **Credits have a hard floor**: they cannot be priced below the API cost of the crawl they buy. An
  "unlimited" plan is therefore impossible by construction. This is a discipline, not a flaw.
- Thin Coverage becomes an offer rather than an embarrassment — it converts our biggest honesty
  problem into a feature only we can sell.
- Discovery paid for by one user permanently enlarges the index for all users, so **customers fund
  the moat**.
