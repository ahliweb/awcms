---
name: awcms-module-management
description: Manage/consume the AWCMS Module Management system (base registry, registry-base composition validation, tenant lifecycle enable/disable, settings, permission sync/status, navigation, job registry, health/readiness). Use when adding a new descriptor field (permissions/navigation/settings/jobs/health) in another module, when investigating why a module looks degraded/orphaned, when adding a domain/website module DIRECTLY to `src/modules/` (ADR-0034: templates are used-directly, there is NO derived-application pathway — `application-registry.ts`/`extension:check` were REMOVED), or when changing module_management's own enable/disable/settings/health behaviour. Per src/modules/module-management/README.md, ADR-0034 (derived pathway removed, supersedes ADR-0014/0015).
---

🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](SKILL.id.md)

# AWCMS — Module Management System

Follow `src/modules/module-management/README.md` (the full source of truth
per issues #511-#521) and `docs/awcms/10_template_kode_coding_standard.md`
§Module contract. This skill summarises the patterns that are **not obvious
from just reading a single file** — the dependency graph, sync ordering, the
settings merge semantics, and the meaning of each health signal.

## When to use this skill vs `awcms-new-module`

`awcms-new-module` = how to **scaffold** a new module (folder structure,
minimal descriptor). This skill = how the **system** that manages already
registered modules works — per-tenant enable/disable, settings, permission
sync, navigation, jobs, health. Use this skill when your module already
exists and you need to declare `permissions`/`navigation`/
`settings`/`jobs` in its descriptor, or when investigating a problem in the
module management system itself.

## "Sync first" — the FK rule you must understand

`awcms_tenant_modules`, `_module_settings`, `_module_health_checks`
all have an FK to `awcms_modules.module_key`. Registering a module in
`src/modules/index.ts` does **not automatically** create its registry row.
Every tenant-scoped mutation that needs the registry row to exist
(`enableTenantModule`/`disableTenantModule`/`updateModuleSettings`/
`runModuleHealthCheck`) calls `syncModuleDescriptors(tx)` itself at the
start — do **not** assume the operator already ran
`POST /api/v1/modules/sync` manually first. When adding a new mutation
with a similar FK, follow the same pattern.

Consequence: `GET /api/v1/modules/{moduleKey}/health`'s `db_registry_synced`
signal can be `fail` on a freshly migrated instance
(no tenant-scoped mutation has ever happened) — this is **not a bug**, it is
an honest report. `POST .../health/check` syncs first as a side effect of
writing history, so it can show a `pass` result for the same signal at the
same moment — a deliberate asymmetry, documented in the module README.

## Dependency graph (enable/disable)

The graph is **always** read from `listModules()` (code), **never**
from `awcms_module_dependencies` (a cache of the last sync — it can be
stale). Error codes from `domain/tenant-module-lifecycle.ts`:

| Code                                 | When                                                   |
| ------------------------------------ | ------------------------------------------------------ |
| `MODULE_NOT_FOUND`                   | Key not registered / globally disabled (code)          |
| `MODULE_ALREADY_ENABLED`/`_DISABLED` | No state change                                        |
| `MODULE_DEPENDENCY_MISSING`          | Dependency not registered at all                       |
| `MODULE_DEPENDENCY_DISABLED`         | Dependency disabled (globally or for this tenant)      |
| `MODULE_REVERSE_DEPENDENCY_ACTIVE`   | Another active module still depends on it              |
| `MODULE_DEPENDENCY_CYCLE`            | Circular dependency in the graph                       |
| `MODULE_VERSION_INCOMPATIBLE`        | Module `minAppVersion` > current app version           |
| `CORE_MODULE_CANNOT_BE_DISABLED`     | `isCore: true` — cannot be disabled, this is not a bug |

A module with `isCore: true` (currently only `module_management` itself)
cannot be disabled — this is the main _admin lockout_ preventer: the ability
to manage other modules is never lost.

### Registry-wide DAG validator (Issue #680, epic #679) — different from `hasDependencyCycle`

`hasDependencyCycle` above was only ever called for ONE module (the one
being enabled, `evaluateModuleEnable` — see `tenant-module-lifecycle.ts:138`)
— it was never used to check "is the WHOLE registry a valid DAG". That gap
is exactly what let `tenant_admin`/
`profile_identity`/`identity_access` carry a real 3-node cycle in their
respective `dependencies` (`tenant_admin -> profile_identity ->
tenant_admin`, and so on) for as long as the registry was never iterated
exhaustively — even though `hasDependencyCycle` WOULD have rejected it had
anyone tried to enable one of those three through the normal path.

`domain/module-dependency-graph.ts`'s `validateModuleDependencyGraph(listModules())`
is that exhaustive check — it detects FOUR different problems
at once (it does not stop at the first): `self_dependency`,
`duplicate_dependency`, `missing_dependency`, and `cycle`
(direct/indirect, exhaustive Kahn algorithm, not a single-point
DFS). Called from:

- `bun run modules:dag:check` (`scripts/validate-module-graph.ts`) —
  inserted into `bun run check` right after `api:spec:check`.
- `bun run modules:sync` (`scripts/modules-sync.ts`) — refuses to sync to the DB
  when the graph is broken, BEFORE any row is touched. Since Issue #697 (epic
  #679), this script is built on top of the shared worker runner
  `src/lib/jobs/job-runner.ts` (advisory lock, `--dry-run` via
  `planModuleSync`, JSON telemetry) — see
  `docs/awcms/deployment-profiles.md` §Shared worker runner; the behaviour of
  `syncModuleDescriptors` itself did NOT change.

**The actual fix for the historical cycle** (Issue #680): `tenant_admin.dependencies`
was changed from `["profile_identity", "identity_access"]` to `[]` —
`profile_identity`/`identity_access`'s arrays were each ALREADY correct
from the start (`profile_identity: ["tenant_admin"]`,
`identity_access: ["tenant_admin", "profile_identity"]`); the only
edge pointing the wrong way was `tenant_admin` pointing back at both.
The historical reason that edge existed: `tenant_admin`'s one-time setup wizard
(`POST /api/v1/setup/initialize`) writes rows into the
`profile_identity`/`identity_access` tables WITHIN the same transaction — that is
a **call-time** need, not "tenant_admin cannot
function at all without both" (a wrong static dependency).
That orchestration is now an explicit composition-root function,
`application/platform-bootstrap.ts`'s `bootstrapPlatformTenant`, called
directly by the route handler — not via the `dependencies` array. Do not
bring this old pattern back if you need similar cross-module orchestration in
the future — create a new composition-root function, do not add a
`dependencies` edge to justify a one-time call ordering.

`resolveProtectedModuleKeys`'s (module-presets.ts) closure result for
`module_management` — `{module_management, tenant_admin, identity_access,
profile_identity}` — did NOT change even after the tenant_admin edge was removed,
because the closure is computed via `identity_access -> profile_identity ->
tenant_admin` (still transitively the same), not via the removed tenant_admin
edge. Verify this through the existing test
(`tests/unit/module-presets.test.ts`'s "real registry's protected set is
exactly module_management's own dependency closure").

### `capabilities` — a source-level relationship, DIFFERENT from `dependencies` (Issue #681, epic #679)

`ModuleDescriptor` has a new optional field, `capabilities?:
{provides?: string[]; consumes?: {capability, providedBy, optional?}[]}`
(`_shared/module-contract.ts`). This is NOT part of the dependency-graph
lifecycle above — `dependencies` remains the only field read by
`hasDependencyCycle`/`validateModuleDependencyGraph`/`evaluateModuleEnable`/
`evaluateModuleDisable`. `capabilities` purely documents SOURCE-LEVEL
IMPORT relationships via the ports-and-adapters pattern (`_shared/ports/*.ts`)
— see ADR-0011 and the `awcms-news-portal` skill §681 for a real
example (`blog_content`/`news_portal`), which is now **historical** (the `news_portal` module was MERGED into `blog_content` — ADR-0044/#300; its table names were kept). A module that needs a capability from
another module NEVER imports that module's `application`/`domain`
directly — only the port interface (`_shared/ports/`) in the
`application`/`domain` layer, with the concrete adapter injected by the caller
(route handler = composition root). `optional: true` in `consumes`
means the caller's feature degrades safely (not an error) if that capability
resolves to "not applicable" for a tenant — it does not mean the code
can run without the other module being compiled (this is a monolith, all source
is always bundled).

**Two composition-root variants already exist in this repo — pick according to
the feature's security stakes, not a single template.** Variant #1
(`blog_content` consuming `NewsMediaPort` from `news_portal`, Issue #681 —
**a historical example**: both are now one module, and the equivalent port today
is `MediaLibraryPort` from `media_library`):
the route handler ALWAYS injects the concrete adapter, WITHOUT checking the
tenant's enable/disable at the call site — the port itself is designed to be
fail-closed/no-op safe for every "not applicable" case. Variant #2 (`identity_access`
consuming `BusinessScopeHierarchyPort` from `organization_structure`,
Issue #746/#749/#786): the composition root (`POST /api/v1/identity/
business-scope/assignments`'s `buildHierarchyPort`) EXPLICITLY
calls `resolveModuleEnabled(tx, tenantId, "organization_structure")`
first — it only tries that module's real adapter when it is active for that
tenant, falling back to the consuming module's default adapter otherwise. Pick
variant #2 (explicit gate) when the consumed capability determines an
authorization/security decision (here: whether a scope reference is
valid before SoD is evaluated) — degrading "safely" implicitly
through the port alone (variant #1) risks silently consulting data
belonging to a module the tenant has in fact disabled. Both variants still
equally NEVER import another module's `application`/`domain`
directly from the consuming module — only via port + composition root,
see `identity-access/README.md` and `organization-structure/README.md`
§`BusinessScopeHierarchyPort` for variant #2 details, and
`tests/integration/business-scope-organization-structure-wiring.
integration.test.ts` for the end-to-end proof.

## Reading tenant-enabled status: plural vs singular

`fetchTenantModuleEntries(tx, tenantId)` (all registered modules) vs
`fetchTenantModuleEntry(tx, tenantId, moduleKey)` (one module, its
`SELECT` filtered on `module_key` directly, not filtered in memory).
Use the **singular** one when your consumer only needs the status of one
specific module (especially in a public/anonymous gate — a narrower read
surface for code that is not authenticated), like `blog-content`'s
`public-news-tenant-resolution.ts`. Use the **plural** one when you really
need the complete list (endpoint `GET /api/v1/tenant/modules`, tenant module
presets, the tenant-module matrix UI). Both have the same
opt-out-by-default semantics (no `awcms_tenant_modules` row
→ `tenantEnabled: true`). Full details:
`module-management/README.md` §Tenant module lifecycle, skill
`awcms-tenant-domain-routing` §Not yet present (Now fixed).

## Tenant module presets (Issue #565, epic #555)

`domain/module-presets.ts` + `application/module-presets.ts`
(`applyModulePreset`) — set a tenant's module state all at once to a
"profile" (`online_website`, `news_portal`, `saas_online`, `pos_lan`,
`minimal`), 100% reusing `evaluateModuleEnable`/`evaluateModuleDisable`/
`enableTenantModule`/`disableTenantModule` above — it **never**
writes `awcms_tenant_modules` directly. A preset applies enables
AND disables (not just enables) — a module that is not in the preset list
and is not "protected" (`isCore` + its transitive dependency closure,
computed dynamically via `resolveProtectedModuleKeys`) will be disabled,
leaves-first, skipping (not forcing) modules still needed by other
modules that stay enabled. Idempotent (re-apply = empty plan). **Service
layer only** — there is no API endpoint/UI yet (scope of Issue #566). Full
details: `module-management/README.md` §Tenant module presets, skill
`awcms-tenant-domain-routing` §Tenant module presets (Issue #565).

## Settings — shallow merge, not replace

`PATCH .../settings` **shallow-merges** the body into the existing
`tenantOverride` (`{ ...before, ...patch }`) — keys not mentioned stay
unchanged. Different from `PATCH /api/v1/settings`'s `featureFlags` (which
replaces that field wholesale) because here the entire request body **is** the
settings resource, not one named field of another resource. Keys that
look like secrets (the same list as `_shared/redaction.ts`'s `REDACTION_KEYS`,
including `credential`) are **rejected at request time** (`400
SETTINGS_SENSITIVE_KEY_REJECTED`), never stored and then redacted
on read. A **value** shaped like a credential is also rejected even if its key
is unsuspicious (`_shared/redaction.ts`'s `findSecretShapedValues` —
JWT, PEM private key block, AWS access key id, raw `Bearer`/`Basic`
headers, connection strings with `user:pass@`; deliberately conservative so that
ordinary labels/URLs/flags are never wrongly rejected) — `400
SETTINGS_SECRET_SHAPED_VALUE_REJECTED`, and the error message only names the key
path, never its value. Applies automatically to every module that
uses `validateModuleSettingsPatch`, with no need to change each
route/module.

## Permission sync status — do not auto-fix `orphaned`

`GET /api/v1/modules/{moduleKey}/permissions` (Issue #517) reports
`synced`/`missing`/`orphaned`/`mismatched_description` — **read-only**,
it never writes to `awcms_permissions`.

As of 2026-08-05 in THIS repo: **ALL 21 modules** (including `idn-admin-regions`,
ADR-0046) declare `permissions` in their descriptor (#251 closed out `email`,
the last of that wave). That means `orphaned` is now
NO LONGER a normal condition for any module — if the report shows it,
that is a real signal, not background noise you can ignore.

Before #251, twelve `email` rows permanently showed as `orphaned` because
its permissions were seeded in `sql/014` but never entered the descriptor. A false
positive that persists like that trains readers to ignore the drift report — the one
thing a drift report must never cause. Still, do not delete
`awcms_permissions` rows based on this report without an explicit admin decision;
`missing`/`orphaned` is fixed by aligning the descriptor OR adding a
seed migration, not by DELETE.

## Route ownership: `api.routes`, not `basePath`

`basePath` is a **display** prefix. What claims ownership is
`api.routes` — a list of prefixes, longest-prefix wins.

Why a list: ownership genuinely is not one prefix. `tenant_admin` owns
`/api/v1/{offices,settings,setup}`, and `/api/v1/tenant` is **split** between
`tenant_domain` (`/domains`) and `module_management` (`/modules`). Non-API
public surfaces count too (`/blog`, `/robots.txt`, `/search`, `/theming`) —
before Issue #256 there were 30 real routes nobody claimed.

> **NEVER write `basePath: "/api/v1"`.** That is the prefix of every route in
> the application; `tenant_admin` once wrote it and swallowed 36 routes belonging to
> other modules (all of `/api/v1/{access,roles,users,abac,identity}` = `identity_access`,
> `/api/v1/tenant/modules` = `module_management`). The gate rejects `/`, `/api`,
> and `/api/v1` explicitly — **a coverage check alone is not enough**: a prefix that
> matches everything leaves zero unclaimed routes, so the coverage gate is
> green while the answer is wrong.

`bun run modules:routes:check` demands that every file under `src/pages` (except
`/admin/**`) maps to exactly ONE module, or is in `PLATFORM_ROUTES`
with a reason. `/admin/**` is deliberately not here — it is already bound by
`tests/admin-navigation-registry.test.ts`; claiming it twice would mean two
sources of truth for the same fact.

## `navigation` = ONE source; the sidebar is rendered from the registry

`ModuleDescriptor.navigation` is now consumed **four** ways:
`descriptor-sync.ts` writes it into `awcms_module_navigation`,
`navigation-registry.ts` serves it via `GET /api/v1/modules`,
`module-composition.ts` validates path conflicts, and
`src/layouts/AdminLayout.astro` **renders the sidebar from it** via
`module-management/domain/sidebar-menu.ts`.

> **The previous version of this section was WRONG from the moment the sidebar was
> rewired.** It told you to ALSO add the link to a static `navSections` array. That
> array no longer exists. Anyone following the old instructions will add a link to a
> file that no longer exists, then think the menu is broken.

How it works:

- `buildDefaultSidebarModel(listModules())` builds the default model = synthetic
  core entries (`CORE_NAV_ENTRIES`, only `/admin` in this base) + each
  non-`disabled` module's `navigation`.
- Section placement comes from `DEFAULT_MODULE_TYPE` (a module→type map), which
  **wins over** `group` in the nav entry. A new module MUST be in this map — the gate
  rejects it otherwise.
- `composeSidebarSections` filters per caller: modules disabled for the tenant
  are dropped, `requiredPermission` decides whether a link is visible. Empty
  sections are not rendered.
- Labels: this base has no gettext catalog, so `labelKey` is resolved via the
  `SIDEBAR_LABELS` table in the same file. Adding a nav entry = adding a label.

**The gate `tests/admin-navigation-registry.test.ts`** enforces both directions: every
`navigation[].path` must have a real page under `src/pages/admin/**`, and every
`/admin/**` page must be claimed by exactly one descriptor or be in
`CORE_NAV_ENTRIES`. It has been proven red for all three violation classes
(dead path, unregistered page, missing label).

Practical consequence when adding a module: declare `navigation` **and**
create its page in the same PR. Declaring it first now fails in CI —
previously it silently shipped a 404 into the DB and into the API.

What does **not** exist yet: awcms-micro's per-tenant override layer
(`sidebar_menu_types`/`sidebar_menu_items` + admin editor) — reorder, hide,
relabel, move type per tenant. That needs its own migration and increment.

## Health check — GET passive, POST explicit

`GET .../health` = cheap generic signals only (registry synced, migrations
applied, permission/jobs/OpenAPI/AsyncAPI documented, settings
valid) — it **never** calls an external provider, safe to call
repeatedly. `POST .../health/check` = the same signals **plus** a live check to
the provider if the module has one (`email` currently, via
`resolveEmailProvider().healthCheck()`, which has been timeout-bounded since
Issue #495) — and it writes history to `awcms_module_health_checks`.
Adding a new provider check for another module: follow the same pattern
(only in `POST`, bounded/non-throwing, `detail` always a fixed generic
string — never a raw error message).

## Job registry — pure documentation

`ModuleDescriptor.jobs` is **never** a surface for executing commands
from the web — it is metadata only (`command`, `purpose`, `recommendedSchedule`,
`environmentNotes`, `safeInOfflineLan`). Do not add an endpoint that
runs commands from here; if executing jobs from the UI is genuinely
needed some day, it must be a separate, tightly constrained feature
(explicit security note in epic #510).

## Verification

`tests/module-management-*.test.ts` (domain, unit, per Issue) and
`tests/integration/module-*.integration.test.ts` (API+RLS+audit
end-to-end, real Postgres) — run `bun test` with `DATABASE_URL`
before a PR touching this system is considered done (`bun run check`
without `DATABASE_URL` **silently skips** every integration test).

## Related skills

`awcms-new-module` (scaffold a new module, including these descriptor
fields), `awcms-abac-guard` (the shared guard that also enforces
`403 MODULE_DISABLED`), `awcms-sensitive-data`/redaction
(the `REDACTION_KEYS` used by settings validation), `awcms-audit-log`
(the audit pattern `tenant_module_enabled`/`_disabled`/`settings_updated`/`health_checked`).

## Module admission policy (Issue #696)

`docs/awcms/21_module_admission_governance.md` defines the
module categories (Core/System/Official Optional Module/Derived Application/
External Integration), admission criteria, the rules for required vs
optional dependencies (§5, complementing `capabilities` above), the
offline/LAN vs full-online-only compatibility expectations, and the mapping of 23 modules
to those categories (including remediation notes for the `type`/`isCore`/`maintainers`
fields that are not yet consistently filled in — see doc 21 §8).

> **Do not read "23 modules" as the registry contents.** `listModules()` returns
> **20** modules (`news_portal` was merged into `blog_content` by ADR-0044/#300); run it if you need the exact number, do not quote doc 21. Of
> the 7 platform-evolution epic #738 modules that doc 21 maps, only
> **`data_lifecycle` and `domain_event_runtime`** are actually registered.
> `organization_structure`, `document_infrastructure`, `data_exchange`,
> `integration_hub`, and `reference_data` **have no code yet** — their ADRs are
> Accepted (0016/0017/0018/0019/0021) but there is no `src/modules/<x>/`.
> `organization_structure` appears only as a `providedBy` string on an
> optional capability in `identity-access/module.ts` — that is a metadata seam, not
> evidence the module exists. The need is recorded in
> `docs/awcms/absorb-awcms-mini-backbone-roadmap.md` — that document is a **list of
> needs**, not a port queue; acquiring them goes through their own ADR admission
> (ADR-0055 §1).

Read that document
before proposing a new module or changing the category/lifecycle status of an
existing module.

## Module composition: validating the BASE registry (ADR-0034 — derived pathway REMOVED)

> **Rule change (ADR-0034, Phase 2).** The derived-application pathway was REMOVED. awcms =
> a template used directly; there is NO derived repo, `application-registry.ts`,
> `extension:check`, `extension.manifest.json`, or migration namespace 900–999.
> Domain/website modules live DIRECTLY in `src/modules/`. The old ADR-0014/0015 =
> historical (superseded by ADR-0034).

What REMAINS (load-bearing base): `src/modules/module-management/domain/module-composition.ts`
validates **the base registry itself** — `composeModuleRegistry()`/
`validateComposedModuleRegistry()` are called by `bun run modules:compose:check` (never
by `index.ts`). `listModules()` = `listBaseModules()` (base only; reference identity
is preserved for `descriptor-sync`).

- **Composition issues that are enforced** (base registry): `duplicate_module_key`,
  `capability_provider_conflict`/`_missing`, `deployment_profile_incompatible`,
  `navigation_path_conflict`, `invalid_job_descriptor`, + the DAG (missing_dependency/
  cycle). **REMOVED** (derived-specific): `prohibited_base_override`,
  `invalid_module_type`, `migration_namespace_overlap`, `mergeModuleRegistries`.
- **`bun run modules:composition:inventory:generate`/`:check`** — a deterministic
  JSON snapshot of the base registry (`docs/awcms/module-composition-inventory.json`),
  wired into `bun run check`.
- **Test fixture**: `tests/fixtures/example-domain-modules/` (example domain modules
  for testing base enforcement #180 business-scope + #181 SoD + composition #178),
  NOT a "derived application".
- **`MODULE_CONTRACT_VERSION` = 4.0.0** as of 2026-08-13 (do not quote the number from
  any document — the source is the constant in
  `src/modules/_shared/module-contract.ts`, which also carries the full history
  along with the reason for each bump). ADR-0034 raised it to
  **2.0.0** (breaking: the `ApplicationModuleRegistry`/`ModuleMigrationNamespace` types
  were removed). The first three MINORs after that are **descriptor-list** seams
  that aggregators discover via `listModules()` — not capability `provides`, because
  multiple providers are expected there and a second provider would trip
  `capability_provider_conflict`:
  - **2.1.0** `dataLifecycle` (#222) — generic retention/archive/purge.
  - **2.2.0** `searchSources` (#231, ADR-0040) — `site_search` index sources.
  - **2.3.0** `commentableResources` (in-flight `feat/port-comments`, ADR-0041) —
    resources that may be commented on.
  - **2.5.0** `ModulePermissionDescriptor.scope` (ADR-0053) — not a
    descriptor-list seam, but an additive field on the permission descriptor; absence
    means `"tenant"`. (The history in `src/modules/_shared/module-contract.ts`
    jumps from 2.3.0 to 2.5.0 — there is no 2.4.0 entry.)
  - **3.0.0** (ADR-0083) — MAJOR: the `"staging"` member was REMOVED from the
    `ModuleDeploymentProfile` union. A published union that narrows = a withdrawal
    of capability, not "documentation synchronisation".
  - **3.1.0** `requiresEntitlement` (ADR-0084) — additive; absence means there is
    no commercial prerequisite.
  - **3.2.0** `subjectData` (ADR-0094, #542) — the fourth descriptor-list seam:
    what each table stores about a person.
  - **4.0.0** (ADR-0094 wave 2, #557) — MAJOR for two reasons that are
    both about MEANING, not size: `SubjectDataErasure` WIDENED with
    `"severed_with_subject_row"` (a widening union is breaking here
    precisely because its consumers are exhaustive `switch`es — the point is to make
    them DECIDE, not fall through to `default`), and `tenantColumn` was retyped
    `string | null` so that `null` states "global" instead of
    absence meaning two things at once.

  Every bump **must** also update the pin
  `contracts.moduleDescriptorContractVersion` in `awcms-family-compatibility.yaml`
  or `bun run family:conformance:check` goes red.

Details: `docs/adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md`.
