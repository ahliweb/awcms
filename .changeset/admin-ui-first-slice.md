---
"awcms": patch
---

Add awcms's first admin management UI — login + admin shell + offices screen — with full E2E coverage (Issue #166, Stage 2). Ports awcms-mini's admin UI pattern, adapted to awcms's fondasi scope; the auth/session/middleware plumbing (`/admin` guard, `resolveSsrContext`, login/logout endpoints) already existed, so this is additive UI.

- **Pages**: `login.astro` (posts to `POST /api/v1/auth/login` with `X-AWCMS-Tenant-ID`, redirects to `/admin`), `admin/index.astro` (dashboard rendered purely from `ssrContext`), `admin/offices.astro` (management screen — SSR-reads the tenant's offices via the same `listOffices` the JSON endpoint uses, permission-gated on `tenant_admin.office_management.read`, renders an accessible table + status badges). A stripped `AdminLayout` and the doc-14 design tokens (`src/styles/tokens.css`) + `admin.css` back them.
- **CSP handled correctly** (Issue #148): the middleware stays the single CSP owner (`default-src 'self'`, covering JSON + HTML + pages). `astro.config.mjs` sets `build.inlineStylesheets: "never"` (external stylesheets) and every page `<script>` imports from `src/lib/ui/admin-form-client.ts` — which forces Astro to bundle it to an external file rather than inline it (an inline script would be CSP-blocked, silently breaking the page). Verified: the login page ships zero inline script/style.
- **E2E**: `login.e2e.ts` (form render + the CSP "no inline script" property) validated live locally; `admin-offices.e2e.ts` drives the full authenticated loop (login → session → `/admin` → offices table + wrong-password generic-error path). The CI `e2e-smoke` job now provisions `postgres:18.4`, runs `db:migrate`, and seeds a tenant+owner through the real `POST /api/v1/setup/initialize` bootstrap.

Read-only offices for this first slice; create/edit stays on `POST /api/v1/offices` and lands later.
