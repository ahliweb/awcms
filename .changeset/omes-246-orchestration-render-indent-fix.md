---
"awcms": patch
---

fix(control-center): CSP-safe depth indentation for the live orchestration tree (ahliweb/omes#246)

Post-merge visual verification of `/admin/omes/orkestrasi-langsung` (ahliweb/omes#246 part 2, PR #834) — logging in as a seeded owner and looking at a populated screen for the first time — found the tree's depth indentation never rendered in any real browser: it was expressed as a per-node inline `style="padding-left: ${depth * 20}px"`, and this repo's CSP (`default-src 'self'`, no `style-src`, no `'unsafe-inline'`; `lib/security/security-headers.ts`) silently drops a dynamic inline `style` attribute. Every manager/agent/subagent row rendered at the same left edge regardless of depth, and the browser console logged a CSP violation per node.

The fix drops the inline style entirely and expresses indentation as a bounded `data-indent-level` attribute (the real depth clamped to 6) plus seven fixed attribute-selector rules in `omes-control-center.css` — CSP-safe by construction, since nothing depends on an inline `style=""` value. The depth *filter* is unaffected: it still reads the unclamped `data-depth` attribute exactly as before.

Verified by seeding a realistic depth-3 manager → 2 agents → 4 subagents → 2 leaves tree (mixed `RUNNING`/`SUCCEEDED`/`FAILED`/`PENDING`/`INTERRUPTED` states) plus a second, deliberately stale session, through the real `ingestOrchestrationTree`/`ingestOrchestrationEvent` functions against a real PostgreSQL, and screenshotting both `/admin/omes/orkestrasi-langsung` and `/admin/omes/hermes` at 1440px and 390px as the seeded owner. No other defect was found in either screen: no horizontal overflow at 390px, the stale session never renders as live, the depth filter correctly hides/shows rows at every tested level, and the Hermes screen's `planner`/step-budget fields render as the documented "not reported" state.

Raises `APP_BUDGET_BYTES` (`scripts/client-asset-budget.ts`) from 234,443 to 234,992 — the measured cost of the fix itself (seven small CSS rules cost slightly more than the removed dynamic inline expression), not headroom for unrelated growth.
