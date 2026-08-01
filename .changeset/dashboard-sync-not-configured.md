---
"awcms": patch
---

Stop the admin dashboard reporting a permanent false alarm when a tenant has no sync nodes.

`shapeSyncHealth`'s `isHealthy` is deliberately `false` for a tenant with zero registered sync nodes — "there is nothing actively syncing" is the right answer for the report. The dashboard rendered that same boolean directly as an amber "Needs attention" badge, so an online-first deployment that never enrols an offline node (ADR-0035 makes sync the resilience mode, not the main path) sat at `0/0` showing a warning with no action behind it. A badge that is always lit is one operators learn to ignore, including on the day it means something.

The dashboard now distinguishes the two states that boolean conflates: **no nodes registered** renders a muted "Not configured", while **nodes enrolled but none active**, open conflicts, or failed objects still render "Needs attention". The `GET /api/v1/reports/sync-health` contract is unchanged — `isHealthy` still answers exactly as before.

The decision is a pure `classifySyncHealthDisplay` in `reporting/domain/sync-health.ts` rather than inline `.astro` frontmatter, so it is reachable by unit tests at all (`tsc --noEmit` does not read `.astro`).
