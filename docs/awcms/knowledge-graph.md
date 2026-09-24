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
| `.graphify_labels.json`                                                   | community names + their signatures                     | ❌ (the blanket `graphify-out/.*` rule)                   |
| `graph.html`                                                              | visualisation                                          | ❌ (see `.gitignore` — the reason is long and deliberate) |
| `cache/`, `.graphify_root`, `.graphify_python`, `.graphify_analysis.json` | cache/marker/intermediate                              | ❌                                                        |

Update it with `/graphify . --update` (incremental; only changed files are
re-extracted). Numbers for the artifact currently committed:
**12700 nodes, 32735 edges, 749 communities**.

`bun run graph:artifacts:check` holds this document to those numbers, and to the
tracked/untracked column above — both were written true and had gone false
before the gate existed (the table claimed `.graphify_labels.json` was tracked;
the figures were a rebuild behind). After every rebuild, update the line above.

What is indexed is narrowed by `.graphifyignore`, which carries the measurement
behind each entry — most importantly that the `*.id.md` translation mirrors
(ADR-0097) are excluded because a mirror restates its source word for word.

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
community (`Tenant Authorization Chokepoint`, 422 nodes in `graph.json`, cohesion
**0.02**) looks like the prime candidate. It is not.

Its contents are **371 nodes from `src/pages/api/` across 110 route files** (138
distinct source files in total), plus `withTenant`, `authorizeInTransaction`,
`fail` and `ok`. That is not a subsystem that has bloated — it is the fan-out
shape of a **deliberate chokepoint** (ADR-0003/ADR-0004: every protected route
MUST go through both). A star topology inevitably yields cohesion close to zero;
clustering algorithms cannot tell a "hub" from a "loose cluster". Splitting it
would break the very security property this repo most wants to keep.

> **Read per-community sizes from `graph.json`, not from the report.** The
> report's `Nodes (N)` line disagrees with `graph.json` for 340 of the 510
> communities it renders, always downward (community 0: 322 in the report, 422 in
> the graph). The Summary totals DO agree, and `graph:artifacts:check` holds them
> to each other — but the per-community figure is a rendering of the report's own
> filtered view, and `graph.json` is what `graphify query` and every GraphRAG
> consumer actually read.

**Rule:** before acting on low cohesion, look at the **composition** of the
community. If the majority of its members come from dozens of different files that
only share one hub, it is an artifact — not design debt.

## Gaps that really are noise

§Knowledge Gaps reports 4189 "isolated" nodes (≤1 connection). Most of them are
`package.json` keys, `$schema`, catalogue entries, and leaf symbols — **not**
undocumented components. Do not treat that number as a backlog.

## Baseline (Issue #805, ADR-0124)

The tested Graphify baseline this repo pins is **`graphify 0.9.35`** (PyPI
package `graphifyy`, installed with `uv tool install graphifyy`), Python 3.12.
Automation and CI must never depend on a floating `latest` — where a tool
version matters (provenance in a generated Obsidian note), it is a literal
constant (`GRAPHIFY_VERSION_BASELINE` in `scripts/knowledge-obsidian-sync.ts`),
not read from whatever happens to be installed on the machine that ran the
command.

Extras this repo's corpus needs (see `awcms-graphify-svg-export-needs-matplotlib.md`
lesson history): `.sql` files produce zero nodes without the `sql` extra, and
SVG export needs both `matplotlib` and `scipy`:

```bash
uv tool install "graphifyy[sql,svg]" --with scipy
```

**Commands approved for interactive use in this repo:**

| Command                                                        | Purpose                                                                                                                |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `graphify . --update`                                          | incremental rebuild (via the `/graphify` skill, semantic extraction may dispatch subagents)                            |
| `graphify update .`                                            | code-only incremental rebuild, no LLM, headless — `bun run knowledge:graph:update`                                     |
| `graphify query "<question>"`                                  | BFS traversal for a question                                                                                           |
| `graphify path "A" "B"`                                        | shortest path between two concepts                                                                                     |
| `graphify explain "X"`                                         | plain-language explanation of one node                                                                                 |
| `graphify --code-only`                                         | index code only, skip doc/paper/image semantic extraction                                                              |
| `graphify export obsidian --dir graphify-out/obsidian-staging` | export to the isolated staging path — `bun run knowledge:obsidian:pull` — **never** without `--dir` pointed at staging |

**`graphify install --project` was evaluated and rejected.** This repo
already ships 55+ project-scoped skills under `.claude/skills/` (ADR-0062
gates them against the code they describe) and its own `AGENTS.md` policy;
adding a second, competing set of agent instructions via
`graphify install --project` (which writes a Claude Code project hook/skill)
would duplicate that policy surface with no CI gate keeping the two in sync.
Graphify continues to run from the contributor's own global skill
(`~/.claude/skills/graphify/SKILL.md`), documented here rather than
re-installed per project.

## Obsidian workflow (Issue #805, ADR-0124)

Obsidian is an **optional developer knowledge UI**, never a system of record.
ADR-0124 decided Obsidian opens a **dedicated `knowledge/` vault**, never the
repository root — read that ADR for the full location analysis (repo-root
vault vs. dedicated vault vs. an uncommitted per-developer path).

```text
graphify export obsidian --dir graphify-out/obsidian-staging   # graphify -> isolated staging (gitignored)
bun run knowledge:obsidian:export                              # staging -> knowledge/generated/graphify/, fail-closed
```

Graphify **never** writes into `knowledge/` directly. Its Obsidian export
target is always the isolated, git-ignored staging path
`graphify-out/obsidian-staging/`. The only thing allowed to move content out
of staging is `scripts/knowledge-obsidian-sync.ts`
(`bun run knowledge:obsidian:export`), which validates the entire staged tree
before writing a single byte and fails closed — non-zero exit, nothing
written, `knowledge/curated/` never touched — on any of:

- **path traversal** — a `..`-shaped entry name, or a real path (after
  resolving symlinks) that does not sit under the staging root;
- **unexpected file type** — anything whose extension is not `.md`/`.canvas`
  (this is what keeps a generated `.obsidian/` config folder or any other
  exporter byproduct out of the synced area, without special-casing the
  directory name);
- **filename collision with curated content** — a staged file whose basename
  already exists anywhere under `knowledge/curated/`;
- **an escaping entry** — a symlink, device file, or anything whose target is
  not a plain file/directory under the staging root.

Every successful sync rewrites `knowledge/generated/graphify/` from nothing
(a clean rebuild, never an incremental merge) and writes one
`PROVENANCE.md` naming the pinned tool version, the source graph's
`built_at_commit`, and the export timestamp — see `tests/knowledge-obsidian-sync.test.ts`
for the proof this behaves as claimed, including against each of the four
fail-closed conditions above using the actual defect shape (a real symlink, a
real `.obsidian/` byproduct, a real basename collision), not merely a healthy
tree.

`knowledge/curated/` holds only small, human-authored index/overlay notes
that point back to canonical files — never a copy of ADR/PRD/contract/doc
content. See `knowledge/README.md` for the vault's own operating rules.

## Obsidian Git hygiene

No `knowledge/.obsidian/` configuration is committed at all — `.gitignore`
excludes the whole directory, not an allowlist with holes. A team-useful
setting can be proposed later through its own reviewed change (and would need
to be a documented allowlist per issue #805 §4, never workspace/session
state, hotkeys, or plugin caches); until then, the safest and simplest
baseline is nothing committed. `knowledge/generated/` is excluded from Git the
same way (`knowledge/generated/*` with `!knowledge/generated/README.md`
kept tracked so the directory is not silently missing in a fresh checkout).
No third-party community plugin is required for the baseline workflow, and
Obsidian is never a CI dependency — `bun run knowledge:check` validates the
sync wrapper's fail-closed behaviour with zero Obsidian, zero Graphify, and
zero network involved.

## Security and privacy (Issue #805 §7)

- **Secrets/PII indexed from ignored or local files:** `.graphifyignore` only
  ever narrows what `.gitignore` already excludes (graphify reads it AFTER
  `.gitignore`), so a secret excluded from Git cannot newly enter the graph
  through this file.
- **Semantic extraction sending sensitive docs to an external provider:**
  Graphify needs no API key for a code-only corpus (structural AST, no LLM).
  Semantic extraction (docs/papers/images) uses Gemini only if
  `GEMINI_API_KEY`/`GOOGLE_API_KEY` is already set; otherwise the host agent
  itself performs it. No other provider key is ever read.
- **Query logs/caches leaking repository context:** `graphify-out/cache/`,
  every dotted intermediate under `graphify-out/`, and `graphify-out/memory/`
  (the `save-result`/`reflect` feedback loop) are all git-ignored — see the
  table at the top of this document and `.gitignore`.
- **Generated Obsidian export overwriting human-authored notes/config:** the
  fail-closed sync wrapper above is the control; `tests/knowledge-obsidian-sync.test.ts`
  proves `knowledge/curated/` survives a full export byte-for-byte unchanged,
  including on every rejected run.
- **Stale graph output treated as current truth:** the "map, not the
  territory" rule at the top of this document, plus `graph:artifacts:check`'s
  freshness note and every generated Obsidian note's `PROVENANCE.md`.
- **Untrusted repository text as prompt-injection content for agents
  consuming the graph:** a graph finding is evidence to verify, never an
  instruction to follow — `knowledge/README.md` §Rules for agents states this
  explicitly, matching the existing rule in this document.
- **Generated artifacts causing excessive repository footprint:** `graphify-out/`'s
  own `.gitignore` rules (see the table above) already exclude the
  render/export surface (`graph.html`, `graph.svg`, `graph.graphml`, …) for
  exactly this reason; `graphify-out/obsidian/`, `graphify-out/obsidian-staging/`,
  and `knowledge/generated/` follow the same posture — none of them are
  tracked in Git.

These controls align with this repo's existing security posture
(default-deny, audited access, no secrets in history) and, where applicable,
with ISO/IEC 27001/27002/27005/27034/27701 principles on information
classification, secure development, and privacy by design. This document does
not claim certification or compliance.
