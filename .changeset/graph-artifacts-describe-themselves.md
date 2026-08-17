---
"awcms": patch
---

chore(graph): the committed knowledge graph gets a checker — and it immediately caught the prose lying about it

`graphify-out/` has been tracked here since PR #400, arranged by four `.gitignore`
rules that each carry a paragraph of reasoning. Not one of them had a checker, and
**nothing in the repo read `graphify-out/` at all** — 51 gates, none of which could
see the artifact.

The sibling repo `awcms-astro` already learned what that costs. It shipped a graph
where **60 of 101 community labels were attached to the wrong communities**:
community 6 named `content-blocks.ts` while its members came entirely from a
performance document, and three separate communities all named `BaseLayout.astro`.
The JSON was valid, the report was tidy, every gate was green. Community names are
not decoration — they are what `graphify query`, any GraphRAG consumer, and any
human navigating the graph actually read. A graph that names its own communities
wrongly is worse than no graph, because it answers confidently.

**The same silence had already produced two false claims here**, both found by
running the new gate for the first time rather than by reading the file:

    docs/awcms/knowledge-graph.md: states 8159 nodes, graph.json holds 9574
    docs/awcms/knowledge-graph.md: states 21470 edges, graph.json holds 26456
    docs/awcms/knowledge-graph.md: states 485 communities, graph.json holds 570
    docs/awcms/knowledge-graph.md: lists `.graphify_labels.json` as tracked,
                                   but git does not track it

Both were written true and went false when the artifact moved underneath them —
the failure mode the whole `.generated` discipline in this repo exists to prevent,
in a document that had no pair.

`bun run graph:artifacts:check` (gate 51) checks five things: only the four shared
artifacts are tracked; the report's Summary line agrees with `graph.json`; every
community has a name somebody chose (not a filename, not the `Community N`
placeholder, no duplicates, and matching between report and graph); nothing under
a `.graphifyignore` entry appears in the graph; and the documentation matches the
artifact. It reads only files already in the repo — no build, no network, no
graphify installation — so it runs in CI. It costs ~80ms on a 15 MB graph.

**Staleness is reported, never fatal.** The distance from `built_at_commit` to
`HEAD` prints as a note. Making it red would force every PR touching an indexed
file to carry a multi-megabyte rebuild, and a gate that expensive gets relaxed
within a month. What is guarded is the artifact's internal honesty; when to
rebuild stays a deliberate decision, and the note keeps that decision visible.

**`.graphifyignore` arrives with its measurement, not its opinion.** It excludes
the `*.id.md` translation mirrors: ADR-0097 makes them hash-tracked, word-for-word
restatements of an English source that is already indexed. The number is what
makes the case — the corpus holds 260 of them and the last graph had scanned only
4, because 256 (`.claude/skills/**/SKILL.id.md`) landed on 2026-08-15 in commit
`01c06f39`, *after* that graph was built. So the exclusion reads as near-free
against today's artifact (8 nodes, 0.08%) while actually keeping 256
restatements out of the next rebuild. Verified against `graphify.detect` rather
than assumed: 0 mirrors in the corpus afterwards.

It also records what is deliberately **not** excluded. `awcms-astro` excludes
`.changeset/`; that decision does not transfer. There it was 171 of 971 nodes
(18%) with 139 of 178 edges pointing at other changesets — an isolated blob. Here
it measures 15 nodes from 5 files (0.16%), with 8 of 17 edges crossing out into
the rest of the corpus. Same directory name, opposite shape.

**One walker replaces nine.** `scripts/lib/repo-files.ts` now holds the recursive
descent that nine scripts had each written for themselves — `repo-inventory.ts`
and `project-state-inventory.ts` carried the same function *byte for byte*. The
others differed in ways nobody chose: `site-origin-check.ts` skipped every
dot-entry while `logging-lint-check.ts` descended into them;
`logging-lint-check.ts` returned `[]` for a missing directory while
`astro-script-typecheck.ts` threw; `i18n-catalog-check.ts` skipped `node_modules`
and `catalogs` while `repo-inventory.ts` skipped nothing. A gate that walks a
smaller tree than its author believed is green *because it never looked*, which is
the one failure mode that never asks to be investigated.

Every option therefore defaults to the most literal behaviour — descend
everything, keep every regular file, absolute paths, throw on a missing directory
— so no call site was quietly narrowed. Six were migrated and the equivalence was
**proven, not asserted**: each replaced implementation was run beside the new one
over the real tree and compared as a set (414, 361, 1033, 43, 984, 984, 100, 982,
361 files — identical every time, none empty), and the six gates' output diffed
byte-identical before and after.

The gate's own test feeds it the defects that actually happened — the `awcms-astro`
filename and duplicate labels, and this repo's stale figures and wrong tracking
column — and requires each rule to go **red**. A test that only proves a gate green
on today's tree proves nothing about the gate.
