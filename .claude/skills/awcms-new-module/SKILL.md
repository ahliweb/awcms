---
name: awcms-new-module
description: Scaffold a new module in the AWCMS modular monolith. Use when creating a new domain module in src/modules/ (e.g. warehouse-management, accounting-tax) or when you need the module.ts + domain/application/infrastructure/api structure + README. Follow the standard structure of doc 10 & 11.
---

🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](SKILL.id.md)

# AWCMS — New Module Scaffold

Create the module following the standard structure in `docs/awcms/10_template_kode_coding_standard.md` and `docs/awcms/11_implementation_blueprint.md`.

## Required structure

```text
src/modules/<module-kebab>/
├── module.ts            # ModuleDescriptor
├── domain/               # entities.ts, value-objects.ts, events.ts
├── application/          # services.ts, commands.ts, queries.ts
├── infrastructure/       # repository.ts, mappers.ts
└── README.md             # full design doc: purpose, tables, endpoints, events, dependencies, security invariants (see other modules' READMEs — 94-854 lines, not a short summary)
```

API routes do **not** live inside the module folder — no module has an
`api/` folder (`find src/modules -maxdepth 2 -type d -name api` is
empty). Real routes always live in `src/pages/api/v1/<resource>/...` (Astro
file-based routing), importing the service/repository from the relevant
module's `application`/`infrastructure`. See `awcms-new-endpoint`.

## Module descriptor (`module.ts`)

```ts
import { defineModule } from "../_shared/module-contract";

export const <camelCase>Module = defineModule({
  key: "<snake_case>",
  name: "<Module Name>",
  version: "0.1.0",
  status: "active", // active | experimental | deprecated | maintenance | disabled
  description: "...",
  dependencies: ["tenant_admin", "identity_access", "observability_logging"],
  type: "domain", // base | system | domain | integration — a new domain module (not generic infrastructure) uses "domain"
  // The OpenAPI contract is split per module (Issue #182, ADR-0026): this module OWNS
  // its own fragment; `openApiPath` points at the fragment, not the GENERATED bundle.
  // After editing the fragment: `bun run openapi:bundle` + `bun run api:docs:generate`.
  // `basePath` = the module's PRIMARY prefix (display/documentation). `routes` = ALL prefixes
  // it owns, including non-API public surfaces. NEVER write
  // `/api/v1` here: that is the prefix of EVERY route in the application, and `modules:routes:check`
  // rejects it (Issue #256 — `tenant_admin` used to write it and swallowed 36 routes
  // belonging to other modules). May be omitted when the module has only one prefix;
  // its absence means `[basePath]`.
  api: {
    openApiPath: "openapi/modules/<module>.openapi.yaml",
    basePath: "/api/v1/<module>",
    routes: ["/api/v1/<module>"] // + public prefix, e.g. "/<module>"
  },
  events: {
    // awcms uses ONE AsyncAPI file (not yet split per module like OpenAPI).
    asyncApiPath: "asyncapi/awcms-domain-events.asyncapi.yaml",
    publishes: [],
    subscribes: []
  }
  // Other optional fields (Issue #511, epic #510 — Module Management):
  // isCore, permissions, navigation, settings, jobs, health,
  // compatibility, maintainers. Declare them only after the real
  // feature in question EXISTS in this module — do not claim
  // capabilities that are not implemented yet (see the real example:
  // `src/modules/module-management/module.ts` added `navigation`
  // only after Issue #518 was finished, `jobs` after #519, one at a time).
});
```

## Rules

1. Register the module in `src/modules/index.ts` (`modules[]`).
2. `key` = `snake_case`; folder = `kebab-case`; type = `PascalCase`.
3. Thin route → guard → validation → service → repository (see `awcms-abac-guard`).
4. Include clear TODOs; do not claim production-ready.
5. If the module has tables → `awcms-new-migration`. If it has an API → `awcms-new-endpoint`. If it has events → `awcms-new-event`.
   5b. **Every `awcms_*` table this module owns MUST answer the data-subject question** (ADR-0094) via `subjectData: [...]` in this descriptor — not optional, and not only for tables that "contain personal data". `bun run subject-data:coverage:check` rejects a silent table; if your table really does not store anything about a person, that still has to be STATED (`NO_SUBJECT_DATA` in `scripts/subject-data-coverage-check.ts`, with a reason), not skipped. A second gate `bun run subject-data:registry:check` verifies that the answer is correct against `sql/`. Full procedure + the five `erasure` modes: the `awcms-data-lifecycle` skill §Data subject rights.
6. **Syncing the descriptor to the database registry is mandatory** (Issue #513, epic #510) — registering the module in `src/modules/index.ts` alone does **not** automatically create the `awcms_modules`/`_dependencies`/`_navigation`/`_jobs` rows. Run `POST /api/v1/modules/sync` (or `bun run modules:sync` when a CLI script is available) at least once after the module is registered — or rely on the automatic sync already wired into some tenant-scoped mutations of other modules that have an FK to `awcms_modules` (`enableTenantModule`/`disableTenantModule`/`updateModuleSettings`/`runModuleHealthCheck` all call `syncModuleDescriptors(tx)` themselves) — **do not assume** the operator has synced manually before your new module is used through that path.
7. If the module declares `permissions` in the descriptor, verify as well that its permission seed migration is consistent (`GET /api/v1/modules/{moduleKey}/permissions`, Issue #517, will report `missing`/`mismatched_description` if it is out of sync).

## Valid module names

Retail/POS domain examples (aspirational, not necessarily present in this generic base): `tenant-admin`, `identity-access`, `profile-identity`, `catalog-inventory`, `sales-pos`, `shared-stock-routing`, `warehouse-management`, `accounting-tax`, `crm-communication`, `sync-storage`, `ai-analyst`, `localization-ui`, `observability-logging`, `database-connectivity`, `workflow-approval`, `management-reporting`, `ui-experience`, `production-security-readiness`.

Modules that are **actually registered** in this repo — the `src/modules/index.ts` order, **22 modules**, verify with `listModules()` and do not quote the number from any document: `logging`, `tenant-admin`, `profile-identity`, `identity-access`, `module-management`, `domain-event-runtime`, `sync-storage`, `workflow-approval`, `email`, `reporting`, `theming`, `media-library`, `blog-content`, `tenant-domain`, `visitor-analytics`, `data-lifecycle`, `seo-distribution`, `form-drafts`, `site-search`, `comments`, `idn-admin-regions` (ADR-0046), `push-delivery` (ADR-0074, status `experimental` — the queue + worker already run, the admin surface does not exist yet).

**What is NOT in the registry** even though its ADR is `Accepted` or its skill exists: `data-exchange`, `document-infrastructure`, `integration-hub`, `organization-structure`, `reference-data`, `social-publishing` (not built here yet), and `news-portal` (**merged** into `blog_content` — ADR-0044/#300).

## Before scaffolding a new module: check the admission policy

Before creating a new module in this base repo (as opposed to merely changing
an existing module), read `docs/awcms/21_module_admission_governance.md`
(the Core/System/Official Optional Module/Derived Application/
External Integration categories, the admission decision tree, the dependency &
security review criteria) and fill in
`docs/awcms/templates/module-proposal-template.md` in the related GitHub
issue. A module specific to one business domain (POS, warehouse, tax, CRM, etc.)
still has to pass the admission decision tree of doc 21 §3 before being added.

**ADR-0034 removed the derived-application pathway.** There are no more derived
repos, no `src/modules/application-registry.ts`, no `extension:check` command, no
`extension.manifest.json`, and no separate `900+` migration namespace — all of it
has been deleted (ADR-0034 supersedes ADR-0014/0015/0025). The AWCMS family under
development is now TWO repos: `awcms` (this repo, system of record + all the
SYSTEM admin screens) and `awcms-astro` (public pages + the USER admin surface
when the site declares one) — ADR-0055 and ADR-0070. This template is used
DIRECTLY ("templates are used-directly"), not as a basis for a derivative repo;
`awcms-mini`/`awcms-micro` are ARCHIVES. The consequence for a new domain/website module: that module lives
DIRECTLY in this repo's `src/modules/` and is registered in `src/modules/index.ts`
(step 1 above), exactly like any other base module — `type: "domain"`, the same
`module.ts` + `domain/application/infrastructure` structure, and migrations use
the sequential base numbering (not a separate namespace). Real evidence: the
`theming` module (ADR-0034 Phase 3, skill `awcms-theming`) is the first website
module ported DIRECTLY into this base. Governance details: the skill
`awcms-module-management` §Build-time module composition and
`docs/adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md`
(supersedes ADR-0014/0015/0025).

Verify the composition seam (registry-base only, no derived pathway):
`bun run modules:compose:check` and
`bun run modules:composition:inventory:check` (regenerate the inventory with
`bun run modules:composition:inventory:generate`) — **two** commands, both part
of `bun run check`. There is no `bun run extension:check`: that command was
deleted along with the derived-application pathway (ADR-0034), do not reference
it again.

## Verification

- `bun run build` passes.
- The module is registered in the base registry `src/modules/index.ts`, then
  `bun run modules:compose:check` is green (there is no derived registry — ADR-0034).
- The module README is filled in.
