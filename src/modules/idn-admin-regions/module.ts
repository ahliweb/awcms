import { defineModule } from "../_shared/module-contract";
import {
  IDN_ADMIN_REGIONS_MODULE_KEY,
  IDN_DATASET_ACTIVITY_CODE,
  IDN_REGION_ACTIVITY_CODE
} from "./domain/idn-admin-regions-permissions";

/**
 * `idn_admin_regions` — Official Optional Module admitted by ADR-0046: versioned
 * master data for Indonesia's administrative hierarchy (province / regency-city
 * / district / village), sourced from the vendored third-party dataset
 * `cahyadsn/wilayah` (MIT). Admission, schema, import pipeline, dataset
 * lifecycle, and the read-only lookup API land together.
 *
 * ## What this module OWNS
 *
 * `awcms_idn_region_datasets` (one row per imported version, with upstream
 * provenance and lifecycle status) and `awcms_idn_admin_regions` (the 91,599
 * normalized regions of one version) — both `sql/080`. Plus the import job
 * (`bun run idn-regions:import`), the activate/rollback actions, and
 * `/api/v1/idn-regions/*`.
 *
 * ## GLOBAL reference data — the deliberate exception (ADR-0046 §3)
 *
 * Neither table has `tenant_id` or RLS: province "Aceh" is the same row for
 * every tenant, the way `awcms_permissions`/`awcms_modules` are. Both are
 * registered in `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES`
 * (`scripts/security-readiness.ts`), which forces an explicit per-role privilege
 * declaration instead of inheriting blanket DML. What is global is the ROW, not
 * the permission — every endpoint still runs session + tenant context +
 * default-deny ABAC.
 *
 * ## EVERY lifecycle action is a JOB (ADR-0052 corrected this)
 *
 * Import, activation, and rollback are all `awcms_worker` jobs, dry-run by
 * default, never HTTP calls.
 *
 * Activation and rollback used to be ABAC-gated endpoints, on the reasoning that
 * "who switched the platform to which version" is a request-path decision. That
 * reasoning was wrong in a way that mattered: the permissions it required
 * (`dataset.configure`/`.restore`) sat in the GLOBAL catalog, which
 * `setup/initialize` grants wholesale to every tenant's `owner` — so an ordinary
 * tenant owner could swap the dataset served to every OTHER tenant, and ABAC saw
 * nothing wrong because it evaluates the permission, not who the action affects.
 *
 * These tables are global (no `tenant_id`, no RLS). There is no tenant the
 * action belongs to, so there is no tenant permission that can honestly express
 * it — the same conclusion ADR-0046 §5 already reached for import ("no
 * request-time subject for an ABAC guard to evaluate"). Hence the permission
 * catalog now has no `import`, no `configure`, and no `restore` action: seeding
 * any of them would advertise a surface that does not exist.
 *
 * ## `type: "system"` — divergence from awcms-mini, on purpose
 *
 * `awcms-mini` typed this module `base`. This repo has no `base`-typed module at
 * all, while `media_library` already established "System Foundation,
 * `isCore: false`" for exactly this shape: a shared capability owned by the
 * platform rather than by a tenant. Introducing a third type value for one
 * module would add a category every gate and matrix has to answer, buying no
 * behaviour (ADR-0046 §2).
 *
 * ## Deliberately NOT here
 *
 * No `capabilities`: consumers read the lookup API, and a capability port would
 * be indirection with one implementation. No `events`: nothing subscribes to
 * region changes, and an unconsumed channel is a claim without a reader. No
 * `dataLifecycle`: these tables are versioned reference data, never purged by
 * age — a dataset is superseded, not aged out. The island/population/area dumps
 * are vendored but read by no code.
 */
export const idnAdminRegionsModule = defineModule({
  key: IDN_ADMIN_REGIONS_MODULE_KEY,
  name: "Indonesia Administrative Regions",
  version: "0.1.0",
  status: "active",
  type: "system",
  isCore: false,
  description:
    "Versioned master data for Indonesia's administrative hierarchy — province / regency-city / district / village (38 / 514 / 7,285 / 83,762 rows in the currently vendored dataset) — for address forms, branch and coverage mapping, and regional reporting (ADR-0046). Owns `awcms_idn_region_datasets` and `awcms_idn_admin_regions` (sql/080), both GLOBAL reference data with no tenant_id and no RLS: the rows are identical for every tenant, exactly like the permission and module registries, and both are registered in `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES` so each role's privileges are declared explicitly rather than inherited. Data comes from the vendored third-party dataset `cahyadsn/wilayah` (MIT) under `data/idn-admin-regions/`, whose bytes, checksums, upstream commit, and per-file Kepmendagri decree reference are committed alongside it — this is a community packaging of the decree, NOT an official Kementerian Dalam Negeri API or export, and that caveat is carried in code and in the API response. Importing parses the vendored SQL dump as TEXT (no SQL engine, no MySQL, no network), validates it whole (unparsed line, duplicate code, orphaned parent, or a missing tier all fail the import rather than importing a partial hierarchy), and writes one new dataset version alongside the previous one — never over it, which is what makes rollback a status flip instead of a re-import. Import runs as the `awcms_worker` job `bun run idn-regions:import` (dry-run by default, `--commit` to write) and always lands `validated`; making a version the one that is SERVED is a separate operator job (`bun run idn-regions:activate`, with `bun run idn-regions:rollback` to undo), also dry-run by default. ADR-0052 moved those two off HTTP: they change the data served to EVERY tenant, so no tenant-scoped permission can honestly authorize them, and the permissions that used to gate them are revoked by `sql/084`. The single-active rule is enforced by a partial unique index in the database rather than by an application check two concurrent callers could interleave through. The read-only lookup API (`/api/v1/idn-regions/*`) defaults to the active dataset, supports tier/parent/name filters with keyset pagination, and can be pointed at a superseded version for comparison.",
  dependencies: ["tenant_admin", "identity_access"],
  api: {
    openApiPath: "openapi/modules/idn-admin-regions.openapi.yaml",
    basePath: "/api/v1/idn-regions",
    routes: ["/api/v1/idn-regions"]
  },
  // This module DOES declare `navigation` (below). It did not always: ADR-0052
  // turned dataset activation/rollback into operator jobs and removed their HTTP
  // surface, which left nothing to build a screen around. ADR-0053 restored the
  // endpoints behind a platform-scoped gate and the `/admin/idn-regions` screen
  // landed with them (PR #332), in the `operations` section its
  // `DEFAULT_MODULE_TYPE` placement had already reserved.
  //
  // Before that screen existed, declaring a nav entry would have pointed the sidebar at
  // a page this repo does not have — the exact drift
  // `tests/admin-navigation-registry.test.ts` exists to catch.
  jobs: [
    {
      command: "bun run idn-regions:import",
      schedule: {
        mode: "manual",
        because:
          "Runs on deploy, and only when the vendored dataset actually changed. A timer would re-parse an unchanged dump forever."
      },
      purpose:
        "Parse, validate, and import the vendored Indonesia administrative region dump as a new dataset version (status `validated`, never auto-activated). Dry-run by default: `--commit` is what writes. Re-running the same bytes collides on the deterministic dataset code instead of creating a duplicate version, so it is safe to run on every deploy.",
      recommendedSchedule:
        "on deploy after the vendored dataset changes — not on a timer (the source is a repo file, not a feed)",
      safeInOfflineLan: true
    },
    {
      command: "bun run idn-regions:activate",
      schedule: {
        mode: "manual",
        because:
          "A platform operator activates a reviewed dataset version deliberately. Automatic activation would publish a dataset nobody read."
      },
      purpose:
        "Choose which imported dataset version the platform SERVES (`--dataset <code|uuid>`). Dry-run by default; `--commit` writes. ADR-0052 moved this off HTTP: it swaps data served to every tenant, so no tenant permission can express it.",
      recommendedSchedule:
        "manually, by a platform operator, after reviewing an imported version — never on a timer",
      environmentNotes:
        "Pure PostgreSQL operation as `awcms_worker` — no network egress. Safe in offline/LAN deployments. Writes no `awcms_audit_events` row: that table is tenant-scoped and this action is global (ADR-0052 §Konsekuensi); the evidence is `status`/`activated_at` on the dataset row plus this command's output.",
      safeInOfflineLan: true
    },
    {
      command: "bun run idn-regions:rollback",
      schedule: {
        mode: "manual",
        because:
          "A recovery action. A recovery action on a timer is not a recovery action."
      },
      purpose:
        "Return the platform to the PREVIOUSLY active dataset version. Dry-run by default; `--commit` writes. The destination is resolved from activation history and is never supplied by the caller — naming it would make this an activation wearing a safer-sounding name.",
      recommendedSchedule:
        "manually, by a platform operator, to recover from a bad activation — never on a timer",
      environmentNotes:
        "Pure PostgreSQL operation as `awcms_worker` — no network egress. Safe in offline/LAN deployments. Same audit caveat as `idn-regions:activate`.",
      safeInOfflineLan: true
    }
  ],
  // `/admin/idn-regions` — the dataset console (ADR-0053). Gated on
  // `dataset.read`, the permission its READ panels need, so an ordinary tenant
  // can see which version it is being served and where that data came from.
  // The two write controls need platform-scoped permissions AND the platform
  // tenant; the page renders them only when both hold, and the chokepoint —
  // never the page — is what enforces it.
  //
  // ADR-0051 §Keputusan butir 3 asks that a navigation entry for a
  // cross-tenant action be gated on the platform permission. This entry is
  // gated on `dataset.read` instead, deliberately: the SCREEN is not
  // cross-tenant, only two of its buttons are, and gating the link on
  // `dataset.configure` would hide the provenance every tenant is entitled to
  // read about data it is being served.
  /**
   * ADR-0094 wave 2 (Issue #557) — ADR-0046 made both of this module's tables
   * GLOBAL (no `tenant_id`, no RLS), so both are outside a per-tenant answer by
   * construction rather than by choice.
   */
  subjectData: [
    {
      key: "idn_admin_regions.idn_region_datasets",
      tableName: "awcms_idn_region_datasets",
      ownerModuleKey: IDN_ADMIN_REGIONS_MODULE_KEY,
      tenantColumn: null,
      subjectColumns: [
        { column: "created_by", references: "tenant_user" },
        { column: "activated_by", references: "tenant_user" }
      ],
      exportable: false,
      erasure: "retain_under_obligation",
      rationale:
        "ADR-0046 — one row per vendored Kepmendagri dataset, naming the platform operator who imported and activated it. The table is global, so no single tenant may hand over or destroy it; the provenance of reference data every tenant depends on is not one controller's to erase."
    },
    {
      key: "idn_admin_regions.idn_admin_regions",
      tableName: "awcms_idn_admin_regions",
      ownerModuleKey: IDN_ADMIN_REGIONS_MODULE_KEY,
      tenantColumn: null,
      unreachableBySubject: true,
      subjectColumns: [],
      exportable: false,
      erasure: "retain_under_obligation",
      rationale:
        "ADR-0046 — the administrative region list itself: province, regency, district and village names from a public dataset. Public geography, global, and about places rather than people."
    }
  ],
  navigation: [
    {
      labelKey: "admin.layout.nav_idn_regions",
      path: "/admin/idn-regions",
      order: 74,
      requiredPermission: "idn_admin_regions.dataset.read"
    }
  ],
  permissions: [
    {
      activityCode: IDN_REGION_ACTIVITY_CODE,
      action: "read",
      description:
        "Look up Indonesia administrative regions (province/regency/district/village) from the active or a named dataset version"
    },
    {
      activityCode: IDN_DATASET_ACTIVITY_CODE,
      action: "read",
      description:
        // Verbatim from the catalog row (`sql/080`), which names the domain
        // where this had shortened it to "dataset versions". `sql/148` fixed
        // the other five description drifts the other way round — the rule was
        // "make both registers say the better sentence", not "make the catalog
        // obey the code".
        "Read imported Indonesia administrative region dataset versions and their upstream provenance (repository, commit, checksum, decree reference)"
    },
    // `dataset.configure` (activate) and `dataset.restore` (rollback) are back
    // — but as PLATFORM-scoped permissions (ADR-0053, seeded by `sql/085`),
    // which is the precondition ADR-0052 set for their return.
    //
    // The history is worth keeping, because the shape of the original bug is
    // easy to recreate: both swap the dataset served to EVERY tenant
    // (`awcms_idn_region_datasets` is global — no `tenant_id`, no RLS), yet
    // they first shipped as ORDINARY tenant permissions in the global ABAC
    // catalogue, which `setup/initialize` grants wholesale to each new tenant's
    // `owner`. An ordinary tenant owner therefore held authority over data
    // served to other tenants, and ABAC saw nothing wrong: it evaluates the
    // permission, not who the action ultimately affects. ADR-0052 removed them
    // rather than guard them, because the guard did not exist yet.
    //
    // `scope: "platform"` is what changed. It keeps them OUT of the blanket
    // grant a new tenant's owner receives, and `access-guard.ts` refuses them
    // unless the acting tenant is the platform tenant — so the authority cannot
    // be exercised from a tenant even if a grant row for it appears somehow.
    {
      activityCode: IDN_DATASET_ACTIVITY_CODE,
      action: "configure",
      scope: "platform",
      description:
        "PLATFORM: choose which imported dataset version is served to every tenant (activate)"
    },
    {
      activityCode: IDN_DATASET_ACTIVITY_CODE,
      action: "restore",
      scope: "platform",
      description:
        "PLATFORM: return every tenant to the previously active dataset version (rollback)"
    }
  ]
});
