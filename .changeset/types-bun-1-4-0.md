---
"awcms": patch
---

chore(deps-dev): @types/bun 1.3.14 -> 1.4.0

Types only — no runtime code changes. `bun run typecheck` (`tsc --noEmit` over
the whole tree, including the extracted `.astro` frontmatter and client scripts)
is clean on the new definitions, which is the only thing a types bump can
actually break.

Stated rather than left for a reader to notice: the type definitions now run
AHEAD of the runtime this repo pins. `packageManager` is `bun@1.3.14`, every CI
job pins `1.3.14` (with the minimum-supported job on the `1.3.0` floor), and
`@types/bun` is now 1.4.0 — so a 1.4-only API would type-check here and be
absent at run time. Nothing in this change reaches for one; the guard against it
is that the tests and the build run on the pinned runtime, not on the types.
