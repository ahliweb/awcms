---
"awcms": patch
---

Add a create-office form to the admin offices screen (Issue #166), permission-gated on `tenant_admin.office_management.create`, posting to the existing `POST /api/v1/offices` via cookie auth; CSP-safe (external bundled script). Authed E2E covers create → row appears.

- **`admin/offices.astro`** — renders `#office-create-form` above the existing table only when the SSR context holds `tenant_admin.office_management.create`. On submit the bundled `<script>` (imports `lockElement`/`postJson` from `admin-form-client`, forcing Astro to emit it external per the `default-src 'self'` CSP) reads `officeCode`/`officeName`/`officeType`, `POST`s to `/api/v1/offices` (cookie auth — no tenant header), reloads on success, and shows a single generic error otherwise (never internal detail, Issue #540). Double-submit is guarded via `lockElement`.
- **E2E** — new `tests/e2e/admin-offices-create.e2e.ts`, env-gated like `admin-offices.e2e.ts`: the seeded owner fills the form with a per-run unique code and the new row appears in `#offices-table` after reload.

The endpoint, validation, ABAC guard, and duplicate/parent handling already existed; this slice is additive UI + coverage.
