🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](knowledge-graph.id.md)

# Knowledge graph (`graphify-out/`)

`graphify-out/` is a **committed** artifact produced by the `graphify` skill: one
knowledge graph over the whole repo (code via AST, documents/contracts via
semantic extraction). This document explains how to read it — and more
importantly, **what must NOT be concluded from it**, because the two misreadings
below produce findings that sound convincing and are wrong.

| File                                                                      | Contents                                               | Tracked?                                                  |
| ------------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------- |
| `graph.json`                                                              | raw graph (~12 MB) — the source that gets queried      | ✅                                                        |
| `GRAPH_REPORT.md`                                                         | audit report: god nodes, communities, hyperedges, gaps | ✅                                                        |
| `manifest.json`, `cost.json`                                              | incremental state + accumulated tokens                 | ✅                                                        |
| `.graphify_labels.json`                                                   | community names + their signatures                     | ✅                                                        |
| `graph.html`                                                              | visualisation                                          | ❌ (see `.gitignore` — the reason is long and deliberate) |
| `cache/`, `.graphify_root`, `.graphify_python`, `.graphify_analysis.json` | cache/marker/intermediate                              | ❌                                                        |

Update it with `/graphify . --update` (incremental; only changed files are
re-extracted). Numbers as of 2026-07-27: **8159 nodes, 21470 edges, 485 communities**.

## What this graph is good at answering

Finding **cross-module patterns that have no import at all** — that is where its
value is, because that is precisely what neither `grep` nor `modules:dag:check`
can find. A real example from the last run: the graph clustered on its own the
discipline _"anonymous surfaces answer uniformly, no oracle"_ across `comments`,
self-registration, and password-reset — three modules without a single structural
edge between them. Same for the `listModules()` seam (`searchSources`,
`commentableResources`, `dataLifecycle`, `api.routes`), which are all the same
architectural move.

## Two ways to misread it (both have already happened)

### 1. The graph mixes "was once true" with "is true now"

Nodes and edges are extracted from **text**, including `CHANGELOG.md` and
changesets. A changelog entry describing a bug that has **already been fixed**
still becomes a node, and can show up under §Surprising Connections as if it were
a live finding. In the 2026-07-27 audit, three of the top five "surprising
connections" were like that — e.g. "ghost env vars `AUTH_JWT_SECRET`/`APP_TIMEZONE`
documented but never read", which is already settled (zero occurrences in
`.env.example`).

**Rule:** never use the graph to answer _"is X still true"_. Every finding must
be verified against the code/`sql/`/`bun run check` first. The source of truth
for state remains the code — the graph is a map, not the territory.

### 2. Low cohesion ≠ a module that needs splitting

`GRAPH_REPORT.md` suggests splitting low-cohesion communities. The largest
community (`Tenant Transaction & Authorization Core`, 264 nodes, cohesion
**0.031**) looks like the prime candidate. It is not.

Its contents are **242 route handlers from 83 different files**, plus `withTenant`
and `authorizeInTransaction`. That is not a subsystem that has bloated — it is the
fan-out shape of a **deliberate chokepoint** (ADR-0003/ADR-0004: every protected
route MUST go through both). A star topology inevitably yields cohesion close to
zero; clustering algorithms cannot tell a "hub" from a "loose cluster". Splitting
it would break the very security property this repo most wants to keep.

**Rule:** before acting on low cohesion, look at the **composition** of the
community. If the majority of its members come from dozens of different files that
only share one hub, it is an artifact — not design debt.

## Gaps that really are noise

§Knowledge Gaps reports ~3400 "isolated" nodes (≤1 connection). Most of them are
`package.json` keys, `$schema`, catalogue entries, and leaf symbols — **not**
undocumented components. Do not treat that number as a backlog.
