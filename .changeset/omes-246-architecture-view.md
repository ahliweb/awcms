---
"awcms": minor
---

feat(control-center): OMES Architecture Control Center screen (ahliweb/omes#246 part 3)

Adds `/admin/omes/arsitektur`, the fourteenth and final `omes_control` admin screen for issue ahliweb/omes#246: a read-only projection of the ADR-0017 layered reference architecture, rendered as planes (lanes) of capability cards with an implementation-status badge per card, following the redesign reference's "Arsitektur" view binding.

**This is a PINNED RELEASE SNAPSHOT, not live host state.** Unlike every other `/admin/omes/*` screen, this one has no database table and no tenant-scoped query behind it — every tenant sees the identical vendored payload. The data is `contracts/v1/fixtures/architecture-capabilities-view/valid-01-generated.json`, re-vendored byte-for-byte from OMES commit `339f2f371aa20b2e9ec6b839488804160ab4e08a` via `bun run contracts:omes:sync` and pinned by SHA-256 in `contracts/v1/PIN.json`. The screen renders the snapshot's own `omes_version`/`omes_commit`/`generated_at` and states explicitly, in both `id` and `en`, that this is a pinned snapshot rather than a live projection from an enrolled host.

**A NEW permission, `architecture.read` (`sql/165`), guards this screen — deliberately not a reuse of `hermes_orchestration.read`.** This screen's subject (the cross-cutting OMES/Hermes/Omarchy/AWCMS/provider layered-architecture registry) has no audience overlap with the Hermes delegated-task/subagent orchestration family the other three #246 screens share one permission for.

`application/architecture-directory.ts` loads and validates the vendored fixture against the vendored schema (`assertOmesContract`, the same fail-closed validator every other OMES contract consumer in this module uses) before `domain/architecture.ts`'s pure `projectArchitectureSnapshot` groups capabilities into their declared planes. Adds `tests/admin-omes-control-architecture-page-contract.test.ts` (permission-guard contract, pinned-snapshot wording, and a schema round-trip test proving the projection drops no required field). `APP_BUDGET_BYTES` raised from 234,992 to 236,936 B (measured delta, re-measured after rebasing onto PR #835's orchestration-indent fix) for the new screen's compiled markup/script/style chunk.
