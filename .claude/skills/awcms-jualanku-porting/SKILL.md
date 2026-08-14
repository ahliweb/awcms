---
name: awcms-jualanku-porting
description: "PLAN — porting Jualanku.info (merchant directory + seller portal + affiliate portal) into the AWCMS family, decided in [ADR-0045](../../../docs/adr/0045-jualanku-porting-awcms-system-of-record-astro-bff.md) in this repo + ADR-0014/0015 in `awcms-astro`. THERE IS NO CODE YET: no `jualanku_*` module/table/migration/route/permission, and the registry is now 21 modules (not 20 — checked 4 August 2026). Use when working on any part of Jualanku — it holds the decisions that CANNOT be inferred from the code: a merchant is modelled as a BUSINESS SCOPE (not a new ABAC attribute — the ABAC allow-list is CLOSED), RLS separates tenants NOT merchants, the browser never calls awcms directly (the BFF is in awcms-astro), five bounded contexts not seven, and the real session gap is cross-origin introspection not cookie support. Full design: `docs/awcms/jualanku/`."
---

🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](SKILL.id.md)

# AWCMS — Porting Jualanku.info (a plan, no code yet)

> **STATUS — P0, ZERO CODE.** As of this skill being written (2026-07-29): there
> is no `src/modules/jualanku-*`, no `awcms_jualanku_*` table, no Jualanku
> migration, route, or permission. `listModules()` returns **20** modules.
> Verify for yourself before believing any sentence here —
> `ls src/modules` and `ls sql/` are the source of truth, not this skill.

## When to use this skill

When working on any part of Jualanku.info: the data model, authorization,
endpoints, admin screens, or the portals. It holds the decisions that **cannot be
inferred from the code** and that are expensive to guess wrong.

The full design lives in [`docs/awcms/jualanku/`](../../../docs/awcms/jualanku/README.md)
(9 documents). This skill is only the binding summary + the pitfalls.

## Five binding decisions

1. **A merchant is a business scope, NOT a new ABAC attribute.**
   `ABAC_ATTRIBUTES` (`identity-access/domain/abac-policy.ts`) is a **closed**
   allow-list: an unknown attribute = invalid at authoring time, deny at
   evaluation time. `subject.merchantIds`/`resource.merchantId` are **not in it**
   and **must not be added** — widening it for one product destroys the very
   property that makes it valuable. What is used instead: `resource.businessScopeId`
   (already exists) + the ADR-0030 scope hierarchy port. **The base is no longer a NO-OP:**
   [ADR-0060](../../../docs/adr/0060-business-scope-hierarchy-provided-by-tenant-admin.md)
   (4 August 2026) made `tenant_admin` resolve the office scope hierarchy,
   so that port has a provider. What is still missing: **the MERCHANT scope shape** —
   mapping a Jualanku merchant onto a scope still needs its own admission ADR,
   and the `jualanku_directory` that will populate it. The earlier note here
   read "the base returns a fail-closed `resolved: false`"; that was true
   until ADR-0060 and misleading afterwards.
2. **RLS separates tenants, not merchants.** One operating tenant
   (`JUALANKU_MAIN`), many merchants. Merchant isolation needs THREE layers: tenant
   RLS + effective-dated scope grants + **an ownership predicate in every
   query**. Never infer isolation from `FORCE` RLS alone — and
   test it as the `awcms_app` role, because on a superuser PaaS RLS can be
   inert while migrations stay green.
3. **The browser never calls `awcms` directly.** `awcms-astro` is the
   only BFF. The BFF may orchestrate + project; it does **not** decide
   ownership, entitlement, or status transitions. If a check exists only in
   the BFF, that check does not exist.
4. **Five bounded contexts, not seven**: `jualanku_directory`,
   `jualanku_catalog_growth`, `jualanku_affiliate`, `jualanku_commercial`,
   `jualanku_trust_operations`. The boundaries follow invariants and data
   ownership, not the menu structure.
5. **The session gap is not "cookies are not supported yet".** `resolveAuthInputs()`
   already accepts a header **or** an httpOnly cookie — that is how SSR admin works
   today. What is missing: a session introspection contract for a **different
   origin** (`/api/v1/auth/me` really is bearer-only).

## Known pitfalls

- **A permission may only use an `AccessAction` that EXISTS.** There is no
  `submit`/`verify`/`payout`. Using an action outside the union produces a
  permission that is never seeded and a silent deny against the tenant owner,
  green in CI because nothing tests it. The mapping in use is in
  [`02-model-tenant-merchant-otorisasi.md`](../../../docs/awcms/jualanku/02-model-tenant-merchant-otorisasi.md) §5.
- **A `permissions` descriptor does NOT grant permissions to existing tenants.**
  Every module must carry its own seed migration; deploying to an existing tenant needs
  an `awcms_role_permissions` backfill, or they 403 with no visible cause.
- **A cross-table FK between tenant-scoped tables must be a composite `(tenant_id, id)`.** A plain FK
  bypasses RLS.
- **Do not write a `sql/NNN` number for a migration that does not exist yet** in any
  document: `bun run check:docs` fails on a ghost migration reference.
- **Every new domain module needs an admission ADR** per
  [`docs/awcms/21_module_admission_governance.md`](../../../docs/awcms/21_module_admission_governance.md) —
  ADR-0045 decided the architecture, not the admission of each module.

## What is reused (do not rebuild it)

`blog_content` (articles, versioned legal pages), `seo_distribution`,
`site_search` (declare `searchSources`), `media_library` (presigned upload;
the portal never sends a free-form image URL), `theming`, `tenant_domain`,
`visitor_analytics`, `comments`, `data_lifecycle`, `email`,
`workflow_approval` + `sodRules` for maker-checker payouts, `form_drafts`.

## Order of work

P0 (ADR + session contract + data model + descriptors) → P1 domain foundation → P2
public → P3 seller portal → P4 affiliate portal → P5 pilot. One bounded
context per PR, each carrying its migration, permission seed, OpenAPI fragment,
negative tests, documentation, and a changeset. Gate/KPI/regulatory detail:
[`07-roadmap-gates-kepatuhan.md`](../../../docs/awcms/jualanku/07-roadmap-gates-kepatuhan.md).
