---
"awcms": patch
---

chore(deps): the held-back register can hold transitive packages (`transitive: true` + `releaseCondition`). New offline gate `bun run deps:held-back:check` (in `bun run check`) requires every exact-version `package.json` `overrides` pin to have a matching register entry and vice versa, checked against `bun.lock`; the weekly `deps:freshness` report reads the registry latest for transitive entries and flags a newer release. The `@astrojs/compiler-rs` 0.5.2 pin (Issue #1367) moves from a documentation table into the register (dependency-governance EN + ID).
