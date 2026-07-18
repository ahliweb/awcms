---
"awcms": patch
---

Add admin management screens for profiles, modules, and email templates (Issue #166) — extending the admin UI to more of the requested management surface, each following the offices screen's SSR-read-then-render pattern backed by an existing awcms API.

- **`admin/profiles.astro`** — the tenant's central profiles/parties via `listParties` (gated `profile_identity.profile_management.read`). Identifiers (masked PII) are deliberately not bulk-listed.
- **`admin/modules.astro`** — the module catalog via `fetchModuleCatalog` (gated `module_management.modules.read`).
- **`admin/email-templates.astro`** — tenant email templates via `listEmailTemplates` (gated `email.template.read`), including inactive.

All three are permission-gated (clean "no access" notice otherwise), degrade to an error notice on a DB circuit-breaker `Response`, and are linked from the `AdminLayout` sidebar. The authenticated E2E (`admin-offices.e2e.ts`) now also navigates through them and asserts their tables render for the seeded owner (the module catalog assertion is data-seed-free — it lists the code-registered core modules).

Read-only for this slice. NOTE: the other requested domains — user management, RBAC (roles/assignments), and ABAC (policies) — have no read API in awcms yet (the tables exist but no `listTenantUsers`/`listRoles`/`listAbacPolicies` application function or route is ported), so their admin screens depend on porting those backend reads from awcms-mini first, per the mini-first flow.
