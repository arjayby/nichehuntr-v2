# Context

The ubiquitous language of nichehuntr. Terms here are the canonical names for domain
concepts — use them verbatim in code, issues, and conversation.

This file is a glossary, not a spec. No implementation details.

## Discovery

### Channel

A YouTube channel as it exists **in our index** — not as it exists on YouTube. A Channel is
the unit a user searches, filters, and sorts. It is a flat, self-contained document: its
current stats and its precomputed [Growth Metrics](#growth-metric) live directly on it, so a
search never has to compute across other documents.

A Channel enters the index by [Seeding](#seeding) and is kept current by [Refresh](#refresh).
Its stats are therefore always *as of* its last Refresh — a Channel is a cached belief about
YouTube, never live truth.

### Video

A video belonging to a Channel. Videos are ingested **for every Channel in the index**, because
Channel-level facts (form mix, median views, cadence, outliers) are only derivable from them.

Videos are not user-searchable in the first release. They are infrastructure that Channel search
is computed from. Exposing Video search later requires no new ingestion.

### Form

Whether a Video is a **Short** or a **Long-form** video. Form is a property of a *Video*,
never of a Channel.

A Channel does **not** have a form. It has *form ratios* — see [Form Share](#form-share).
We deliberately do not store a `shorts` / `longform` / `mixed` verdict on a Channel, because
any threshold that produces such a verdict destroys information we care about.

### Form Share

Two ratios (0–1) held on a Channel, each measured over a recent window:

- **Shorts Upload Share** — the fraction of the Channel's recent uploads that are Shorts.
  What the Channel *makes*.
- **Shorts View Share** — the fraction of the Channel's recent views that came from Shorts.
  What actually *works* for the Channel.

The gap between the two is itself a signal. A Channel that is 90% Shorts by upload but 10%
Shorts by views is telling you its Shorts are not its business. "Shorts-dominant" is therefore
a *query* over these ratios, not a stored fact.

### Channel Snapshot

An append-only record of a Channel's stats at one moment in time, written by [Refresh](#refresh).

Snapshots exist to make change measurable. They are the only source of [Growth
Metrics](#growth-metric) — a rate of change is not a fact about a Channel, it is a fact about
two Snapshots subtracted.

Snapshots are never read during a search. They are read by the job that computes Growth Metrics.

**History cannot be backfilled.** A Snapshot not taken is a measurement lost permanently. This is
the reason Refresh must begin as early as possible.

### Growth Metric

A rate-of-change value derived from [Channel Snapshots](#channel-snapshot) and then written back
onto the Channel document so it can be filtered and sorted directly (e.g. subscribers gained in
the last 30 days).

Growth Metrics are what distinguish a Channel that is *rising* from a Channel that is merely
*large*. Two Channels with identical current stats can be opposite investments; only Growth
Metrics tell them apart.

### Momentum

A Channel's *current* performance, computed from a single crawl: views on videos published
recently, relative to the Channel's own lifetime average.

Momentum needs no history — every Video carries a publish date and a view count — which is why
it, and not subscriber growth, is the metric the product leads with. Subscribers are a lagging
indicator (the residue of past success); Momentum is a leading one.

### Entry Bar

The rule deciding whether a Channel is allowed into the index at all: **a minimum level of recent
views, with no subscriber requirement.**

The Entry Bar is the thesis in one rule. A 300-subscriber Channel with 800k views this month is
admitted; a 50,000-subscriber Channel that has not uploaded in a year is not. It also garbage-
collects: a Channel that goes quiet eventually falls below the bar and ages out on its own.

Consequence, accepted deliberately: a dormant Channel with a great back-catalogue disappears from
the index. We are a hunting tool, not an archive.

### Niche

**A named, saved set of search criteria** — keywords plus filters — created by a user. There is no
curated taxonomy of niches and no ground-truth list of what niches exist.

A Niche is what makes set-level questions askable: because a Niche defines a *set* of Channels, we
can measure that set (how many Channels match, how fast that count is growing, what the median
performance is) and so answer *"is this niche worth entering?"* — which is the question the user
actually has. A Channel is never the answer; a Niche is.

Because the user defines the set, an incoherent Niche yields incoherent measurements. Good starter
Niches are a product responsibility.

### Coverage

What the index knows about an area of YouTube, and how recently it looked.

Coverage exists so the product can distinguish **"this niche is empty"** from **"we have not looked
there."** Without it, a thinly-indexed area is indistinguishable from an uncontested opportunity,
and the product would confidently advise a user to invest in a niche on the basis of our own
ignorance. That is the most dangerous failure this product can have, and it is a modelling failure,
not a bug.

Thin Coverage on a user's query is not an error state — it triggers [Discovery](#discovery).

### Discovery

Finding Channels not yet in the index and admitting those that pass the [Entry Bar](#entry-bar).

Discovery is **demand-driven**: a user query into a thinly-covered area expands the index toward
that area. Users' queries steer what slice of YouTube we come to own, so the index grows along the
axis of revenue.

### Seeding

The initial, bulk form of [Discovery](#discovery): populating the index from a third-party data
source for breadth on day one. We buy *breadth*, never *depth* — depth is what we own.

### Refresh

Re-reading a Channel from YouTube and writing a new [Channel Snapshot](#channel-snapshot).
Refresh is what we own; it is the origin of all history.

Refresh is **not uniform**. Each Channel has a Refresh priority, a function of its
[Momentum](#momentum) (fast movers are watched closely), user demand (Channels appearing in saved
[Niches](#niche) are watched closely), and volatility (Channels that never surprise us are watched
rarely).

### Crawl Budget

The scarce, finite quota of external API calls available per day, allocated by policy across
[Refresh](#refresh) and [Discovery](#discovery).

Crawl Budget is a first-class domain concept, not an implementation detail: index size, freshness,
and Coverage are all direct functions of it, and it is the binding constraint the product operates
under. Product quality *is* budget allocation.

### Freshness

How long ago a Channel was last [Refreshed](#refresh).

Because Refresh is tiered, Freshness is uneven across the index, and it is therefore **always
visible to the user**. A stat presented without its Freshness is a claim we cannot support.

### Signal

A metric a Channel can be filtered or sorted by. Every Signal must be explainable in one sentence
and verifiable by eye — **we do not ship composite scores.**

An "Opportunity Score" would be arbitrary weights wearing a lab coat: we have no ground truth about
which niches actually made anyone money, so the weights could never be fitted or falsified. The
first user who clones a 94-scoring niche and fails discredits every honest Signal alongside it. Our
credibility is the product — we ask people to spend months of their lives on what we show them.

The Signals that matter are **normalised** — they compare a Channel to *itself* or to its own size —
because raw size ranks Channels by how hard they'd be to compete with, which is the opposite of the
question being asked:

- **Views per Subscriber** — the best proxy for *format-driven, cloneable* content. High means the
  content does the work, not the audience.
- **Median Views per Video** — typical performance, immune to a single viral fluke.
- **Outlier Ratio** — best recent Video ÷ median. A recent 10× outlier is a *specific idea* that
  just printed.
- **[Momentum](#momentum)** — is it heating up right now.
- **Upload Cadence** — Videos per week. The only Signal that tells the user what *labour* they are
  signing up for; a niche demanding 5 videos/week is a different business from one demanding 1.
- **Channel Age** — a 4-month-old Channel at 100k subs proves the niche is *currently* enterable.
- **[Shorts View Share](#form-share)**.

Raw subscriber and total-view counts are **filters** (to scope competition level), not sorts.

### Credit

The unit a user spends on [Discovery](#discovery).

Search over the index is unlimited and free on every plan; Discovery — going out to YouTube to learn
something we don't know — is the metered act, because it is the act that spends [Crawl
Budget](#crawl-budget). Credits are therefore denominated in the thing that actually costs us money.

A Credit cannot be priced below the crawl it buys, so an "unlimited" plan is impossible by
construction.
