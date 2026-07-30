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
 * ## Import is a JOB; activation is an audited ADMIN ACTION
 *
 * The dump ships inside the image, so importing 91,599 rows is a deployment
 * step, run as `awcms_worker`, dry-run by default — never an HTTP call.
 * Activation/rollback IS a request-path decision (who switched the platform to
 * which version, and when), so it is ABAC-gated, idempotency-keyed, and audited.
 * That split is why the permission catalog has no `import` action: seeding one
 * would advertise a surface that does not exist.
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
    "Versioned master data for Indonesia's administrative hierarchy — province / regency-city / district / village (38 / 514 / 7,285 / 83,762 rows in the currently vendored dataset) — for address forms, branch and coverage mapping, and regional reporting (ADR-0046). Owns `awcms_idn_region_datasets` and `awcms_idn_admin_regions` (sql/080), both GLOBAL reference data with no tenant_id and no RLS: the rows are identical for every tenant, exactly like the permission and module registries, and both are registered in `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES` so each role's privileges are declared explicitly rather than inherited. Data comes from the vendored third-party dataset `cahyadsn/wilayah` (MIT) under `data/idn-admin-regions/`, whose bytes, checksums, upstream commit, and per-file Kepmendagri decree reference are committed alongside it — this is a community packaging of the decree, NOT an official Kementerian Dalam Negeri API or export, and that caveat is carried in code, in the API response, and on the admin screen. Importing parses the vendored SQL dump as TEXT (no SQL engine, no MySQL, no network), validates it whole (unparsed line, duplicate code, orphaned parent, or a missing tier all fail the import rather than importing a partial hierarchy), and writes one new dataset version alongside the previous one — never over it, which is what makes rollback a status flip instead of a re-import. Import runs as the `awcms_worker` job `bun run idn-regions:import` (dry-run by default, `--commit` to write) and always lands `validated`; making a version the one that is SERVED is a separate, ABAC-gated, idempotency-keyed, audited admin action, with the single-active rule enforced by a partial unique index in the database rather than by an application check two concurrent requests could interleave through. The read-only lookup API (`/api/v1/idn-regions/*`) defaults to the active dataset, supports tier/parent/name filters with keyset pagination, and can be pointed at a superseded version for comparison.",
  dependencies: ["tenant_admin", "identity_access"],
  api: {
    openApiPath: "openapi/modules/idn-admin-regions.openapi.yaml",
    basePath: "/api/v1/idn-regions",
    routes: ["/api/v1/idn-regions"]
  },
  // No `navigation`: managing which region dataset version the platform serves
  // is an OWNER/INTERNAL operator screen, and ADR-0047 puts those in
  // `awcms-astro` (this repo keeps the public surface and the tenant-facing
  // admin). Declaring a nav entry here would point the sidebar at a page this
  // repo does not have — the exact drift `tests/admin-navigation-registry.test.ts`
  // exists to catch. The screen consumes this module's own `/api/v1/idn-regions/*`
  // through that repo's BFF, so nothing about it needs a second data path.
  jobs: [
    {
      command: "bun run idn-regions:import",
      purpose:
        "Parse, validate, and import the vendored Indonesia administrative region dump as a new dataset version (status `validated`, never auto-activated). Dry-run by default: `--commit` is what writes. Re-running the same bytes collides on the deterministic dataset code instead of creating a duplicate version, so it is safe to run on every deploy.",
      recommendedSchedule:
        "on deploy after the vendored dataset changes — not on a timer (the source is a repo file, not a feed)",
      safeInOfflineLan: true
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
        "Read imported dataset versions and their upstream provenance (repository, commit, checksum, decree reference)"
    },
    {
      activityCode: IDN_DATASET_ACTIVITY_CODE,
      action: "configure",
      description:
        "Activate a validated dataset version so it becomes the one served — high-risk, idempotency-keyed, audited"
    },
    {
      activityCode: IDN_DATASET_ACTIVITY_CODE,
      action: "restore",
      description:
        "Roll back to the previously active dataset version — high-risk, idempotency-keyed, audited"
    }
  ]
});
