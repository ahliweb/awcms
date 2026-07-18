---
"awcms": patch
---

Add module enable/disable toggle and email-template create form to the admin UI (Issue #171) — the next slice of admin write actions, each riding an EXISTING awcms endpoint (no new backend), following the create-office form's permission-gated + CSP-safe pattern.

- **`admin/modules.astro`** — a per-row enable/disable toggle, shown to users holding the matching `module_management.tenant_modules.{enable,disable}` permission, posting to the existing `POST /api/v1/tenant/modules/{key}/{enable,disable}` (cookie auth). Core modules are never offered a disable button (the endpoint 409s that); the endpoints' ABAC guard + dependency/core validation remain the real authority — the button gate is UX-only.
- **`admin/email-templates.astro`** — a create form shown to users holding `email.template.create`, posting to the existing `POST /api/v1/email/templates` (cookie auth). `templateKey` is a fixed select of the base categories (`BASE_EMAIL_TEMPLATE_CATEGORIES`); subject/body are captured for the `en` locale and sent as the `{ locale: text }` map the endpoint expects. `validateCreateEmailTemplateInput` (restricted category, localized-text shape, unsafe-HTML rejection) stays the authority.

Both scripts are bundled EXTERNAL (they import from `admin-form-client`) so the `default-src 'self'` CSP allows them; both surface only a single generic error on failure (never internal detail, Issue #540) and guard double-submit via `lockElement`. Authed E2E added for each (`admin-modules-toggle.e2e.ts` toggles then reverts — self-reversing and retry-safe; `admin-email-templates-create.e2e.ts` is idempotent on the fixed `templateKey`). Both run in the CI `e2e-smoke` job.

Remaining #171 scope (RBAC assign/unassign + role-permission mutation, ABAC policy authoring, edit/soft-delete/restore) needs newly-ported backend endpoints and is left to a focused follow-up cycle.
