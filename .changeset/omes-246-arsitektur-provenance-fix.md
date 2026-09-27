---
"awcms": patch
---

fix(control-center): show real vendoring provenance on the OMES Architecture screen, not the fixture's placeholder commit/timestamp

`/admin/omes/arsitektur` (ahliweb/omes#246 part 3) was rendering the vendored `architecture-capabilities-view` fixture's own `omes_commit` (`0000000000000000000000000000000000000000`) and `generated_at` (`2026-01-01T00:00:00Z`) as if they were real provenance. Those are DELIBERATE deterministic placeholders OMES's generator (`scripts/generate-architecture-capabilities-view.py`) writes so the checked-in fixture reproduces byte-for-byte — never a record of when or from which commit this snapshot was actually vendored.

The screen now shows the real answer instead: the OMES version (`snapshot.omesVersion`, taken from the fixture's `omes_version`, which IS real), the source commit (`contracts/v1/PIN.json`'s `sourceCommit` — a short prefix inline, with the full 40-character SHA in a title/tooltip), and vendored-at (`PIN.json`'s `syncedAt`). The "pinned release snapshot, not live host state" banner is unchanged.

`domain/architecture.ts` renames the fixture's own fields to `fixtureOmesCommit`/`fixtureGeneratedAt` and documents them as internal-only (used solely to round-trip the projection back through schema validation in tests) — never to be rendered. `application/architecture-directory.ts` now attaches a `provenance` object (`sourceCommit`/`sourceCommitShort`/`vendoredAt`) sourced from the already-exported `OMES_CONTRACT_PIN`. `tests/admin-omes-control-architecture-page-contract.test.ts` asserts the page renders `snapshot.provenance.*`, never `snapshot.omesCommit`/`generatedAt`/`fixtureOmesCommit`/`fixtureGeneratedAt`, and that the displayed commit is never the all-zero placeholder. New `id`/`en` labels "Source commit" / "Vendored at" replace "OMES commit" / "Generated at".

Refs ahliweb/omes#246.
