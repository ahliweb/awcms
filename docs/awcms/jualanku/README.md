🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](README.id.md)

# Jualanku.info — implementation blueprint in `awcms`

> **The status of this file: A PLAN, not a description of code.** Not a single
> `jualanku_*` module, `awcms_jualanku_*` table, migration, route, or Jualanku
> permission exists in this repo as of the document's date. The source of truth
> for the state of the code remains `src/modules/index.ts`, `sql/`, and
> `bun run check` — if this document differs from the code, **the code is right**.

This folder translates the validation document _"Validasi Arsitektur dan Standar —
Porting UI/UX Jualanku.info ke AWCMS dan AWCMS-Astro"_ v1.0 (PT TIM SIX,
29 July 2026, status `APPROVE WITH CORRECTIONS`) into a design that can be
executed directly in this repo, **after correcting it against the real code**.
The decision itself is recorded in
[ADR-0045](../../adr/0045-jualanku-porting-awcms-system-of-record-astro-bff.md);
this folder is the design detail beneath that decision.

The experience layer side (rendering, adapters, deployment, the BFF) is designed
in the `ahliweb/awcms-astro` repo, because that is where those changes happen.

## Document map

| File                                                                           | Contents                                                                                                                               |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| [01-arsitektur-porting.md](01-arsitektur-porting.md)                           | Layer split, topology, the rendering matrix per surface, the boundary of the BFF's responsibilities.                                   |
| [02-model-tenant-merchant-otorisasi.md](02-model-tenant-merchant-otorisasi.md) | Tenant vs merchant, merchant as a business scope, the role & permission catalogue, ABAC rules, the negative-authorization test matrix. |
| [03-bounded-context-dan-model-data.md](03-bounded-context-dan-model-data.md)   | Five modules, the draft `ModuleDescriptor`, table ownership, the ERD per context, RLS & retention rules.                               |
| [04-kontrak-api.md](04-kontrak-api.md)                                         | The public/portal/admin namespaces, the endpoint inventory, the envelope, idempotency, pagination, the OpenAPI fragment.               |
| [05-kontrak-sesi-dan-bff.md](05-kontrak-sesi-dan-bff.md)                       | The cross-origin session contract, cookies/CSRF, tenant derivation, rotation & revocation, a brief threat model.                       |
| [06-porting-uiux.md](06-porting-uiux.md)                                       | The Elementor disposition matrix, design tokens, screen specifications, components, accessibility, i18n.                               |
| [07-roadmap-gates-kepatuhan.md](07-roadmap-gates-kepatuhan.md)                 | Phases P0–P6, quality gates, KPIs, RACI, go/pivot/pause/stop criteria, standards & regulations.                                        |
| [08-koreksi-dokumen-validasi.md](08-koreksi-dokumen-validasi.md)               | Every claim in the validation document that does **not** match this repo's code, with the evidence and the correction.                 |

## Prerequisites before the first line of code (P0)

The order is binding: each item produces an artifact used by the next.

1. **ADR-0045 accepted** (this repo) and the **rendering/BFF ADR accepted** (the
   `awcms-astro` repo). — _done together with this change._
2. **The module inventory reconciled** so that `README.md`,
   [`docs/ARCHITECTURE.md`](../../ARCHITECTURE.md), and
   [`docs/PROJECT_STATE.md`](../../PROJECT_STATE.md) name the same list and count
   as `src/modules/index.ts`. — _done together with this change._
3. **The cross-origin session contract** ([05](05-kontrak-sesi-dan-bff.md)) agreed,
   in OpenAPI, and covered by tests — including negative tests for CSRF and origin.
4. **The merchant + business scope data model** ([02](02-model-tenant-merchant-otorisasi.md),
   [03](03-bounded-context-dan-model-data.md)) agreed, complete with the
   negative-authorization matrix that must be red before any code exists.
5. **The five `ModuleDescriptor`s + table ownership** frozen
   ([03](03-bounded-context-dan-model-data.md)) — module admission follows
   [`../21_module_admission_governance.md`](../21_module_admission_governance.md):
   one admission ADR per domain module before scaffolding.

Only once all five are closed does production screen work begin — one bounded
context per unit of work, each carrying its own migration, permission seed,
OpenAPI fragment, tests (including negative ones), documentation, and changeset.

## Rules that bind the implementation

Taken from repo contracts that already apply, not new rules:

- **Domain modules live directly in `src/modules/`** and are registered in
  `src/modules/index.ts` (ADR-0034). No derived repo, no extension registry.
- **Every tenant-scoped table must have `FORCE` RLS** and may only be written by
  its owning module (`bun run modules:table-writes:check`).
- **Every endpoint goes through `defineTenantRoute` + a default-deny guard**, and
  the `resourceAttributes` for ABAC are always read from the real row, never from
  the request body (ADR-0033).
- **A new permission = a new seed migration.** The module descriptor alone does
  not grant permissions to tenants that already exist; older tenants stay 403
  until the backfill is run.
- **High-risk actions must have an idempotency key + audit + decision log**, and
  their maker/checker pair must be declared as `sodRules` (ADR-0031).
- **Modular API contracts**: one OpenAPI fragment per module, bundled
  deterministically (ADR-0026). An endpoint without a fragment does not pass
  `bun run api:spec:check`.
