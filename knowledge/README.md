🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](README.id.md)

# `knowledge/` — the optional developer knowledge base

This directory is a **dedicated Obsidian vault** (ADR-0124), for developers who
want a graph-navigable view of AWCMS engineering knowledge. It is **entirely
optional**: nothing in `bun run check`, CI, or the application depends on it,
and no contributor is required to install or open Obsidian. If you have never
heard of Obsidian, you can ignore this directory completely — the repository's
system of record is the code, `docs/`, and `docs/adr/`, exactly as it always
was.

Two rules govern everything under here, and both are enforced by tests
(`tests/knowledge-obsidian-sync.test.ts`) and by the sync wrapper's fail-closed
design, not merely documented:

1. **`knowledge/curated/` is human-authored and Graphify never writes to it.**
2. **`knowledge/generated/` is machine-generated and nobody hand-edits it.**

```text
knowledge/
├── README.md              # this file
├── curated/                # small, human-authored index/overlay notes
│   ├── project-map.md
│   ├── architecture-index.md
│   ├── security-index.md
│   ├── decisions-index.md
│   └── lessons-learned.md
└── generated/               # git-ignored except this note; rebuilt on demand
    ├── README.md
    └── graphify/            # synced from graphify-out/obsidian-staging/
        ├── PROVENANCE.md    # tool version, source commit, export timestamp
        └── ...              # one note per graph node/community
```

## Why a dedicated vault and not the repository root

ADR-0124 evaluated opening the repository root itself as an Obsidian vault
(with strict exclusions) against a dedicated `knowledge/` vault, and chose the
dedicated vault. Read the ADR for the full analysis; in short: a root vault
would index hundreds of thousands of source/build/dependency files that have
nothing to do with navigable knowledge, would need an ever-growing exclusion
list fighting the same battle `.gitignore`/`.graphifyignore` already fight for
a different purpose, and would put Obsidian's own workspace state
(`.obsidian/`) at the repository root where it is far more likely to be
committed by accident. A dedicated vault is small, its `.obsidian/` directory
is fully git-ignored (see `.gitignore`), and it never competes with the
repository's real build/check tooling for attention.

## How content gets here

1. **Curated notes** are written directly by a developer, by hand, as small
   Markdown files under `knowledge/curated/`. They point back to canonical
   files (ADRs, `docs/ARCHITECTURE.md`, `docs/PROJECT_STATE.md`, `SECURITY.md`,
   code) rather than restating them — **do not copy or migrate canonical ADRs,
   PRDs, contracts, or technical docs into this directory.** Code, SQL,
   contracts, tests, and canonical docs remain authoritative; a curated note
   that drifts from what it points to is a bug in the note, not a second
   source of truth.

2. **Generated notes** reach `knowledge/generated/graphify/` only through
   `bun run knowledge:obsidian:export`, which is a deterministic, fail-closed
   sync (`scripts/knowledge-obsidian-sync.ts`) from an isolated staging path
   (`graphify-out/obsidian-staging/`, itself git-ignored) — never directly from
   Graphify, and never touching `knowledge/curated/`. See
   `docs/awcms/knowledge-graph.md` §Obsidian workflow for the full pipeline and
   the security guarantees (path traversal, unexpected file types, filename
   collisions, and non-rebuildable state all fail the sync closed).

## Reading a generated note

Every generated note is Graphify's own hypothesis about the codebase, built
the same way `graphify-out/graph.json` is — see
`docs/awcms/knowledge-graph.md` for the "map, not the territory" rule that
governs everything the graph says. `knowledge/generated/graphify/PROVENANCE.md`
records which commit the underlying graph was built from and when the note was
last synced; a note without a recent, verified provenance line is a lead to
check against the code, not a fact to cite.

## Opening the vault

Point Obsidian's "Open folder as vault" at `knowledge/` (not the repository
root). No community plugins are required for the baseline workflow.

## Personal Obsidian state

If you open `knowledge/` in Obsidian, your own workspace/plugin/UI state lives
under `knowledge/.obsidian/`, which is git-ignored in full (see `.gitignore`
and ADR-0124) — no baseline `.obsidian/` config is committed at all. Do not
commit your personal workspace layout, hotkeys, or plugin caches.

## Rules for agents (including this one)

Prefer `graphify query`/`path`/`explain` over broad context loading when it
materially reduces context size, for discovery and impact analysis. Treat
every graph finding as a **hypothesis** to verify against
code/`sql/`/`bun run check` — never as implementation authority on its own.
Never hand-edit `knowledge/generated/graphify/`; it is rebuilt, not edited.
