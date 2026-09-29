---
"awcms": patch
---

design(admin): migrate the 12 remaining OMES admin screens onto `.admin-status-pill`/`.admin-stat-card` (#865)

Migrates `src/pages/admin/omes/{ai-privacy,arsitektur,audit,backups,deployments,enrollments,hermes,jobs,operations,orkestrasi-langsung,progres-hermes,servers}.astro` off the legacy `.status-badge`/`.status-dot` (`data-variant`) markup onto the shared `.admin-status-pill`/`.admin-status-pill-dot` primitive (`data-tone`), and the five of those screens with a KPI tile (`backups`, `deployments`, `jobs`, `servers`, plus the already-shared `.stat-hint` -> `.admin-stat-card-caption`) onto `.admin-stat-card`/`.admin-stat-card-grid`. `orkestrasi-langsung.astro`'s polling client script (activity-stream re-render) is migrated in lockstep so its client-rendered badge markup matches the SSR rows byte-for-byte, preserving the translated `data-state-labels` lookup and the never-render-stale-as-healthy behaviour. `omes/health.astro` (wave 4, not in scope) and `omes/index.astro` (wave 2, already done) are untouched.

Fixes a latent styling bug along the way: `.status-badge` only ever defined `data-variant="success"|"neutral"|"warning"`, so every OMES site that passed `"danger"`/`"info"` (AI-privacy posture/egress decisions, backup/deployment staleness, repository-progress freshness, Hermes orchestration/session state) silently fell back to the undifferentiated default fill. `.admin-status-pill` defines all five tones, so these now render with the tone they always asked for — no markup logic changed, only the class/attribute names.

`src/styles/omes-control-center.css` needed no new CSS: it already carried the dual `.stat-card`/`.admin-stat-card` selector list from #860 (wave 2) and never redeclared `.status-badge`/`.admin-status-pill` itself — both classes consume the same `--color-*-soft`/`-on-soft` custom properties the file already overrides for the OMES dark palette, so the tone/token cascade carried over automatically. Its docblock and the `.stat-card` dual-selector comment are updated to reflect that only `omes/health.astro` still needs the legacy half now.

`build:asset-budget:check`'s `APP_BUDGET_BYTES` raised from 248,045 to 248,058 (measured actual total, ledger comment in `scripts/client-asset-budget.ts`) — the only growth is `orkestrasi-langsung.astro`'s client script template literal, whose class names got longer.

Two page-contract tests (`tests/admin-omes-control-page-contract.test.ts`, `tests/admin-omes-control-health-backup-audit-page-contract.test.ts`) updated their `data-variant="warning"` assertions to `data-tone="warning"` for `servers.astro`/`deployments.astro`/`backups.astro`; the `omes/health.astro` assertion in the latter file is untouched since that screen is out of scope. No API/schema/event/permission change.
