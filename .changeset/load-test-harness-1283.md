---
"awcms": patch
---

test(loadtest): distributed k6 load-test harness and an ephemeral per-run environment (Issue #1283, owner decision on #1281 option A, ADR-0161). Adds `loadtest/` (k6 scenarios for public pages, an authenticated admin read, an authenticated API write and a 10x-in-60-s spike; a runner that starts several generators with a shared run id; per-generator CPU, network and dropped-iteration saturation sampling; a merge step that accepts a result only when the limit did not come from the generators) and `bun run loadtest:env:up` / `loadtest:env:down` (a separate app plus a throw-away PostgreSQL with synthetic data, marked and guarded so it cannot be pointed at a real database, destroyed after the run). No application source, API, migration or dependency changes, and **no baseline is recorded**: that needs a real run.
