# Refresh priority is a deadline, not a sort key

## Status

accepted

## Context

Refresh is not uniform: a Channel's [Momentum], the demand for it (how many saved [Niches] it appears
in), and its volatility decide how closely it is worth watching. Crawl Budget is finite, so those
three have to resolve into an order in which the day's crawls are actually spent.

The obvious implementation is a score on each Channel and a queue sorted by it, highest first. It
does not survive contact with the domain:

- **The tail starves.** A dull Channel is never the highest-priority thing in the index, so under a
  budget that does not cover everything it is never crawled at all. But a Channel's Snapshot history
  is the only thing that could tell us it has *stopped* being dull, and the Entry Bar only ages a
  quiet Channel out when a crawl notices it went quiet. A Channel we stop watching is a Channel we
  can no longer learn anything about — including that we were wrong to stop watching it.
- **A score does not age.** Priority is computed from what the last crawl found, so a Channel that
  has been waiting three weeks scores exactly what it scored on day one. Nothing about the queue
  knows how long anyone has been in it.

## Decision

**A Channel's Refresh priority buys it a shorter interval between crawls, and the crawl queue is
worked in deadline order — soonest due first.**

Priority (0–1) maps to one of three intervals: hot (6h), warm (24h), cold (7d). A crawl books the
Channel back in at `now + interval(priority)`; so does a *claim*, on the beliefs we hold about the
Channel at that moment, so a Channel that has gone from YouTube and fails every crawl cannot sit at
the head of the queue forever.

When the day's budget runs short, the Channels left behind keep their deadlines: they are deferred,
never dropped, and are first in line the moment there is budget again. Every run that comes up short
is counted on the day's Crawl Budget ledger.

## Consequences

- **A high-Momentum Channel is Refreshed more often than a flat one** — it comes due four times as
  often — which is what the priority was for.
- **Nothing starves.** A cold Channel still reaches the head of the queue by waiting, and no Channel
  goes unread for longer than the coldest interval.
- **Budget exhaustion degrades Freshness in priority order**, because the Channels being watched most
  closely are the ones whose deadlines fall soonest. Degradation is visible in the ledger before it
  is visible to a user.
- The queue is one index scan (`by_refresh_due_at`), not a sort over the index. Priority is stored on
  the Channel anyway, so "why was this Channel not crawled" is a number we can read off it.
- **Demand only re-prices a Channel at its next claim.** Saving a Niche does not immediately pull its
  Channels forward; they are re-priced when they next come due. Accepted for now — if Niches make
  this bite, the Niche can bring its Channels' deadlines forward when it is saved.

[Momentum]: ../../CONTEXT.md#momentum
[Niches]: ../../CONTEXT.md#niche
