---
"awcms": patch
---

Add the browser E2E harness (Playwright + Bun) and a real catch-all 404 page — the first slice of porting awcms-mini's E2E layer, following the mini-first flow.

- **Harness** (`playwright.config.ts`, `test:e2e`/`test:e2e:install` scripts, `@playwright/test` devDep) ported from awcms-mini and adapted: specs live in `tests/e2e/*.e2e.ts` (the `.e2e.ts` suffix keeps `bun test` from ever picking them up), run via `bun --bun playwright test` (Bun-only, AGENTS.md #14), against an already-running app (Playwright's `webServer` can't provision the Postgres this app boots against). See skill `awcms-browser-test`.
- **Catch-all 404** (`src/pages/[...path].ts`) wires the previously-dormant public HTML error responses (`src/lib/html/error-responses.ts`): an unknown browser path now gets a clean, generic 404 HTML page that leaks nothing internal (Issue #540), and an unknown `/api/*` path gets the standard JSON error envelope instead of framework-default chrome. Astro ranks rest params lowest, so every real route still wins.
- **First E2E spec** (`tests/e2e/not-found.e2e.ts`) drives a real Chromium at the 404 page and asserts the clean render + no internal-detail leak. Validated live locally (system Chrome) and wired into a new CI `e2e-smoke` job (`.github/workflows/ci.yml`) — no Postgres needed since the 404 route touches no DB.

Foundation for the admin/management screens (login, offices, …) whose specs land with the first `.astro` pages.
