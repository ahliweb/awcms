🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0124-obsidian-vault-location-dedicated-knowledge-directory.id.md)

# ADR-0124 — Obsidian opens a dedicated `knowledge/` vault, not the repository root

- **Status:** Accepted
- **Date:** 2026-09-24
- **Decision maker:** ahliweb
- **Related:** Issue #805; [`docs/awcms/knowledge-graph.md`](../awcms/knowledge-graph.md); `.graphifyignore`; `scripts/graph-artifacts-check.ts`; `scripts/knowledge-obsidian-sync.ts`; `tests/knowledge-obsidian-sync.test.ts`; `tests/graph-artifacts-check.test.ts`

## Context

Issue #805 asks AWCMS to add a safe, optional Obsidian knowledge-navigation
workflow on top of the already-governed `graphify-out/` knowledge graph,
without turning Obsidian into a second system of record. Graphify can export
an Obsidian vault (one Markdown note per graph node, plus an `.obsidian/`
config folder); the question this ADR settles is **where that vault, and any
human-curated notes, live relative to the repository**, evaluated against:
advantages/disadvantages, security, performance, maintainability, scalability,
operational complexity, compatibility/cross-platform behaviour, developer
UI/UX, duplication, and how much personal state would leak into Git.

Two options were named in the issue, plus a third considered here.

### Option A — open the repository root as the Obsidian vault, with strict exclusions

Obsidian treats `awcms-wt-805/` (the repo root) itself as the vault, relying on
`.obsidian/` + Obsidian's own file-type/folder exclusions to hide everything
that is not meant to be knowledge content.

- **Advantages:** zero duplication of paths — every ADR, doc, and SQL file is
  already "in" the vault at its real path; no export/sync step is needed for a
  developer just reading; cross-references between vault notes and canonical
  files use the same relative paths Git already uses.
- **Disadvantages / security:** a repo root holds `.env.example`, `sql/`
  migrations, and eventually developer-local files (IDE state, `.env`,
  scratch notes) that a careless Obsidian plugin (graph view thumbnails,
  full-text search index, community plugins that phone home) could index or
  upload without anyone reviewing an exclusion list line by line. The
  exclusion list must be **actively maintained forever** — every new
  top-level directory this large, fast-moving monorepo adds (it already has
  25+ modules, `sql/`, `openapi/`, `asyncapi/`, `.claude/`, `graphify-out/`)
  is included in the vault by default until someone remembers to exclude it.
  That is the opposite of this repo's default-deny posture (ADR-0004) applied
  to a filesystem surface instead of an API.
- **Performance:** Obsidian's own indexer (search, graph view, backlinks) has
  to walk the entire repository tree — hundreds of thousands of files
  including `node_modules/`-adjacent build output, `dist/`, `.astro/`, the
  ~19 MB `graphify-out/graph.json` — on every vault open, even though almost
  none of it is a note Obsidian can render usefully.
  It also collides directly with `graphify-out/` (a directory of the same
  name Obsidian would have to be told to ignore) and, worse, with any future
  `.obsidian/`-shaped tooling other agents in this repo's ecosystem might add.
- **Cross-platform:** contributors who never install Obsidian still see a
  vault's worth of exclusion rules living at the repo root, coupling an
  optional developer tool's configuration to a path every contributor's
  editor, linter, and CI job also walks.
- **Personal state in Git:** because the vault root **is** the repo root,
  any personal Obsidian workspace file that escapes `.gitignore` (a plugin
  writing outside `.obsidian/`, a note dropped at the top level by habit)
  lands in the same tree as source code, one `git add -A` away from being
  committed.

### Option B — a dedicated `knowledge/` vault (chosen)

Obsidian opens only `knowledge/` as its vault. Graphify's generated notes are
synced into `knowledge/generated/graphify/` through an explicit,
allow-listed, fail-closed wrapper (`scripts/knowledge-obsidian-sync.ts`);
small human-authored index notes live in `knowledge/curated/`; nothing else
in the repository is inside the vault boundary.

- **Advantages:** the vault boundary **is** a directory boundary — no
  exclusion list to maintain, because everything outside `knowledge/` is
  structurally outside the vault regardless of what gets added to the repo
  next. `.gitignore`/`.graphifyignore`-style narrowing is local to one small
  tree instead of the whole monorepo. Duplication is minimal: `knowledge/`
  holds only overlays that point back to canonical files (`docs/adr/`,
  `docs/awcms/`, `sql/`), never a copy of their content.
- **Security:** the blast radius of "an Obsidian plugin indexed something it
  should not have" is capped at `knowledge/` — a directory that, by
  construction (this ADR's own rule), never receives `.env`, credentials, or
  SQL/source content. This is a smaller, reviewable surface, consistent with
  default-deny.
- **Performance:** Obsidian indexes a few dozen small Markdown/Canvas files
  instead of the ~19 MB graph and the whole source tree; vault open, search,
  and backlink computation stay fast regardless of repository size.
- **Maintainability/scalability:** the vault does not grow when the repo
  grows (new modules, new SQL migrations, new ADRs do not enter
  `knowledge/`); it only grows when `knowledge:obsidian:export` is run, and
  that growth is bounded by `graphify-out/obsidian-staging/`'s allow-listed
  content.
- **Operational complexity:** one extra step (`knowledge:obsidian:export`)
  versus Option A's zero steps, but that step is scripted, tested, and
  fail-closed — the complexity is paid once in code, not repeatedly in
  manual exclusion-list upkeep.
- **Compatibility/cross-platform:** the vault directory is a plain folder
  Obsidian opens on macOS/Linux/Windows identically; nothing in this
  repository's own tooling needs to know Obsidian exists, because `knowledge/`
  carries no build-time meaning outside itself.
- **UI/UX for developers:** a developer who wants the graph as notes opens
  `knowledge/`; a developer who does not use Obsidian never sees `.obsidian/`
  config or vault noise anywhere near the code they are editing.
- **Personal state in Git:** confined to `knowledge/.obsidian/` (gitignored
  except a documented, reviewed allowlist — see the companion Git-hygiene
  decision below), never mixed with source.

### Option C (considered, rejected) — no committed vault; each developer points Obsidian at a local, uncommitted copy

Graphify's Obsidian export writes to an arbitrary path outside the repo
(e.g. `~/vaults/awcms`) that each developer manages independently; nothing
Obsidian-related is committed at all.

- Rejected because it reintroduces exactly the duplication and drift the
  issue is trying to remove: every developer re-exports independently, the
  curated index notes (`project-map.md`, `decisions-index.md`, …) that are
  meant to be **shared** navigation context would have nowhere canonical to
  live, and there is no way to review or gate what a generated vault
  contains (the acceptance criteria require tests over the export allowlist,
  collision handling, and traversal protection — none of which are possible
  against a path outside the repository). It optimises away the small,
  real coordination cost Option B pays once in `knowledge/curated/`.

## Two more scope decisions bundled into this ADR

Issue #805 asks for two further governance decisions alongside the vault
location, both narrow enough to record here rather than as separate ADRs.

### Graphify version/toolchain baseline

The tested baseline is **`graphify 0.9.35`** (PyPI package `graphifyy`,
installed via `uv tool install graphifyy`), Python 3.12. CI and automation
must not depend on a floating `latest` — `scripts/knowledge-obsidian-sync.ts`
records this exact string (`GRAPHIFY_VERSION_BASELINE`) into every
`PROVENANCE.md` it writes, rather than reading whatever `graphify --version`
reports on the machine that ran the export, so provenance states what this
repository vouches for, not what happens to be locally installed. Commands
this repo treats as approved for interactive use are listed in
`docs/awcms/knowledge-graph.md` §Baseline; `graphify install --project` was
evaluated and **rejected** — see that section for why.

### `cost.json` stays tracked

`graphify-out/cost.json` (already a tracked artifact, unchanged by this ADR)
holds only aggregate per-run counters: an ISO date, `input_tokens`,
`output_tokens`, a file count, and an optional `mode` string. It carries no
provider name, no API key, no per-file breakdown, no query text, and no path
outside `graphify-out/` itself. Reviewed against the issue's concern that it
"may contain local/cost/provider information": it does not, and does not need
to — the aggregate token counts are exactly the information a reviewer needs
to judge a rebuild's cost, and removing it from Git would only make that
number unavailable to anyone who was not the operator who ran the rebuild.
It remains tracked, unchanged.

## Decision

1. **Obsidian's vault root is `knowledge/`, never the repository root.**
   Nothing outside `knowledge/` is exposed to Obsidian by this repo's
   workflow.
2. **`knowledge/curated/`** holds small, human-authored index/overlay notes
   only (`project-map.md`, `architecture-index.md`, `security-index.md`,
   `decisions-index.md`, `lessons-learned.md`). They point back to canonical
   files; they never copy or migrate ADR/PRD/contract/technical-doc content.
3. **`knowledge/generated/graphify/`** holds only files written by
   `scripts/knowledge-obsidian-sync.ts` from `graphify-out/obsidian-staging/`.
   Its contents are disposable and rebuildable from graphify artifacts; they
   are excluded from Git (see the Obsidian Git-hygiene note in
   `docs/awcms/knowledge-graph.md`) precisely because a one-file-per-node
   export at this repo's graph size (12000+ nodes) would multiply the
   repository's tracked file count many times over for content that already
   exists, machine-readable, in the tracked `graphify-out/graph.json`.
4. Graphify MUST NOT write directly into `knowledge/` by default. Its
   Obsidian export target is `graphify-out/obsidian-staging/` (an isolated,
   gitignored build-intermediate directory, governed the same way as the
   rest of `graphify-out/`'s regenerable exports). Only the sync wrapper may
   move content from staging into `knowledge/generated/graphify/`, and only
   after validating the fail-closed conditions in
   `scripts/knowledge-obsidian-sync.ts` (path traversal, unexpected file
   types, filename collision with `knowledge/curated/`, and exporter output
   escaping the staging root).
5. `knowledge/curated/` is never a write target for any automated tool.

## Consequences

- **Positive:** the vault boundary is enforced structurally (a directory), not
  by a list of exclusions that has to be kept current forever; Obsidian
  indexing performance is independent of repository size; the blast radius of
  a misbehaving Obsidian plugin is one small, non-sensitive directory;
  curated navigation notes have one canonical, reviewable home.
- **Negative / trade-off:** a developer who wants graph content as Obsidian
  notes must run one explicit sync step instead of the vault "just working"
  at the repo root; `knowledge/generated/graphify/` needs its own
  disposability contract (rebuildable, not hand-edited) so it does not
  quietly become a second source of truth.
- **Neutral:** this decision does not change how `graphify-out/` itself is
  governed (that stays as documented in `docs/awcms/knowledge-graph.md` and
  enforced by `graph:artifacts:check`); it only decides where Obsidian, an
  optional UI on top of that graph, is allowed to point.

## Alternatives considered

- **Option A — repository root as the vault** — rejected: unbounded
  exclusion-list maintenance as the monorepo grows, full-repo indexing
  performance cost, and a materially larger surface for personal/local state
  to leak next to source code. See analysis above.
- **Option C — uncommitted, per-developer vault path** — rejected: removes
  the shared home for curated navigation notes and makes the export allowlist
  / collision / traversal tests the issue requires impossible to run against
  a path outside the repository. See analysis above.
