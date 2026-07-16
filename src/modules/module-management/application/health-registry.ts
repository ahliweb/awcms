/**
 * Module health/readiness service. Every signal is cheap and bounded (a
 * handful of lightweight queries + a couple of small file reads) — meant to
 * be safe to call from an admin request, never a long-running or
 * business-transaction-blocking operation. This base has no external-provider
 * live check (a network-calling provider health check would only ever be
 * invoked from the explicit `POST .../health/check` action, never the passive
 * `GET .../health` read — see `providerHealthCheckSignal`).
 *
 * Every catch below logs the real error server-side (via `log()`, doc 10
 * §Logger redaction) but only ever puts a fixed, generic string in the signal
 * `detail` returned to the caller — never a raw error message, stack trace,
 * or `DATABASE_URL`.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "yaml";

import { log } from "../../../lib/logging/logger";
import { listModules } from "../..";
import type { ModuleDescriptor } from "../../_shared/module-contract";
import { fetchModulePermissionSyncReport } from "./permission-sync";
import { fetchModuleSettingsView } from "./module-settings";
import { fetchModuleJobs } from "./job-registry";
import { syncModuleDescriptors } from "./descriptor-sync";
import { validateJobDescriptor } from "../domain/job-registry";
import {
  classifyHealthStatus,
  type HealthStatus,
  type ReadinessSignal
} from "../domain/health-registry";

export type ModuleHealthReport = {
  moduleKey: string;
  status: HealthStatus;
  signals: ReadinessSignal[];
  generatedAt: string;
};

function findDescriptor(moduleKey: string): ModuleDescriptor | null {
  return listModules().find((d) => d.key === moduleKey) ?? null;
}

/**
 * Deliberately a minimal, local re-listing of `sql/*.sql` filenames — not an
 * import of `scripts/db-migrate.ts`'s own `discoverMigrationFiles` (that
 * would be a backwards dependency, `src/` on `scripts/`, and drags in
 * checksum/transaction-control validation this read-only check doesn't need).
 * Just enough to compare "files on disk" vs. "rows already applied".
 */
async function listMigrationFileNames(): Promise<string[]> {
  const migrationsDir = path.resolve(process.cwd(), "sql");
  const entries = await readdir(migrationsDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name);
}

async function migrationsAppliedSignal(
  tx: Bun.SQL,
  correlationId?: string
): Promise<ReadinessSignal> {
  try {
    const fileNames = await listMigrationFileNames();
    const appliedRows = (await tx`
      SELECT migration_name FROM awcms_schema_migrations
    `) as { migration_name: string }[];
    const appliedNames = new Set(appliedRows.map((row) => row.migration_name));
    const pending = fileNames.filter((name) => !appliedNames.has(name));

    return {
      name: "migrations_applied",
      status: pending.length === 0 ? "pass" : "fail",
      detail:
        pending.length > 0
          ? `${pending.length} migration file(s) not yet applied.`
          : undefined
    };
  } catch (error) {
    log("error", "health-registry: migrations_applied check failed", {
      moduleKey: "module_management",
      correlationId,
      error: error instanceof Error ? error.message : String(error)
    });

    return {
      name: "migrations_applied",
      status: "fail",
      detail: "Could not check migration state."
    };
  }
}

async function dbRegistrySyncedSignal(
  tx: Bun.SQL,
  descriptor: ModuleDescriptor,
  correlationId?: string
): Promise<ReadinessSignal> {
  try {
    const rows = (await tx`
      SELECT lifecycle_status FROM awcms_modules WHERE module_key = ${descriptor.key}
    `) as { lifecycle_status: string }[];
    const row = rows[0];

    if (!row) {
      return {
        name: "db_registry_synced",
        status: "fail",
        detail: "No database registry row yet — run the descriptor sync."
      };
    }

    return {
      name: "db_registry_synced",
      status: row.lifecycle_status === descriptor.status ? "pass" : "fail",
      detail:
        row.lifecycle_status === descriptor.status
          ? undefined
          : "Database registry status is stale — run the descriptor sync."
    };
  } catch (error) {
    log("error", "health-registry: db_registry_synced check failed", {
      moduleKey: descriptor.key,
      correlationId,
      error: error instanceof Error ? error.message : String(error)
    });

    return {
      name: "db_registry_synced",
      status: "fail",
      detail: "Could not query the module registry."
    };
  }
}

async function permissionCatalogSyncedSignal(
  tx: Bun.SQL,
  moduleKey: string,
  correlationId?: string
): Promise<ReadinessSignal> {
  try {
    const report = await fetchModulePermissionSyncReport(tx, moduleKey);
    const unsynced = (report?.entries ?? []).filter(
      (entry) =>
        entry.status === "missing" || entry.status === "mismatched_description"
    );

    return {
      name: "permission_catalog_synced",
      status: unsynced.length === 0 ? "pass" : "fail",
      detail:
        unsynced.length > 0
          ? `${unsynced.length} declared permission(s) missing or mismatched in the catalog.`
          : undefined
    };
  } catch (error) {
    log("error", "health-registry: permission_catalog_synced check failed", {
      moduleKey,
      correlationId,
      error: error instanceof Error ? error.message : String(error)
    });

    return {
      name: "permission_catalog_synced",
      status: "fail",
      detail: "Could not check the permission catalog."
    };
  }
}

async function settingsValidSignal(
  tx: Bun.SQL,
  tenantId: string,
  moduleKey: string,
  correlationId?: string
): Promise<ReadinessSignal> {
  try {
    await fetchModuleSettingsView(tx, tenantId, moduleKey);
    return { name: "settings_valid", status: "pass" };
  } catch (error) {
    log("error", "health-registry: settings_valid check failed", {
      moduleKey,
      correlationId,
      error: error instanceof Error ? error.message : String(error)
    });

    return {
      name: "settings_valid",
      status: "fail",
      detail: "Could not resolve effective module settings."
    };
  }
}

function jobsDocumentedSignal(moduleKey: string): ReadinessSignal {
  const jobs = fetchModuleJobs(moduleKey) ?? [];

  if (jobs.length === 0) {
    return { name: "jobs_documented", status: "not_applicable" };
  }

  const invalid = jobs.filter((job) => !validateJobDescriptor(job).valid);

  return {
    name: "jobs_documented",
    status: invalid.length === 0 ? "pass" : "fail",
    detail:
      invalid.length > 0
        ? `${invalid.length} job descriptor(s) have an invalid shape.`
        : undefined
  };
}

const yamlDocumentCache = new Map<string, unknown>();

async function readYamlCached(relativePath: string): Promise<unknown | null> {
  if (yamlDocumentCache.has(relativePath)) {
    return yamlDocumentCache.get(relativePath) ?? null;
  }

  try {
    const source = await readFile(
      path.resolve(process.cwd(), relativePath),
      "utf8"
    );
    const document = parseDocument(source).toJSON();
    yamlDocumentCache.set(relativePath, document);
    return document;
  } catch {
    yamlDocumentCache.set(relativePath, null);
    return null;
  }
}

async function openApiDocumentedSignal(
  descriptor: ModuleDescriptor
): Promise<ReadinessSignal> {
  if (!descriptor.api) {
    return { name: "openapi_documented", status: "not_applicable" };
  }

  const document = (await readYamlCached(descriptor.api.openApiPath)) as {
    paths?: Record<string, unknown>;
  } | null;
  const paths = document?.paths ? Object.keys(document.paths) : [];
  const hasBasePathEntry = paths.some((p) =>
    p.startsWith(descriptor.api!.basePath)
  );

  return {
    name: "openapi_documented",
    status: document && hasBasePathEntry ? "pass" : "fail",
    detail:
      document && hasBasePathEntry
        ? undefined
        : "No OpenAPI path found under the module's declared basePath."
  };
}

async function asyncApiDocumentedSignal(
  descriptor: ModuleDescriptor
): Promise<ReadinessSignal> {
  const publishes = descriptor.events?.publishes ?? [];

  if (publishes.length === 0) {
    return { name: "asyncapi_documented", status: "not_applicable" };
  }

  const document = (await readYamlCached(
    descriptor.events!.asyncApiPath ?? ""
  )) as { channels?: Record<string, unknown> } | null;
  const channels = document?.channels ?? {};
  const missing = publishes.filter((eventName) => !channels[eventName]);

  return {
    name: "asyncapi_documented",
    status: missing.length === 0 ? "pass" : "fail",
    detail:
      missing.length > 0
        ? `${missing.length} published event(s) missing an AsyncAPI channel.`
        : undefined
  };
}

async function computeGenericSignals(
  tx: Bun.SQL,
  tenantId: string,
  descriptor: ModuleDescriptor,
  correlationId?: string
): Promise<ReadinessSignal[]> {
  return [
    { name: "descriptor_registered", status: "pass" },
    await dbRegistrySyncedSignal(tx, descriptor, correlationId),
    await migrationsAppliedSignal(tx, correlationId),
    await permissionCatalogSyncedSignal(tx, descriptor.key, correlationId),
    await settingsValidSignal(tx, tenantId, descriptor.key, correlationId),
    jobsDocumentedSignal(descriptor.key),
    await openApiDocumentedSignal(descriptor),
    await asyncApiDocumentedSignal(descriptor)
  ];
}

/** `null` means `moduleKey` isn't a registered descriptor — `404`. */
export async function fetchModuleHealthReport(
  tx: Bun.SQL,
  tenantId: string,
  moduleKey: string,
  correlationId?: string
): Promise<ModuleHealthReport | null> {
  const descriptor = findDescriptor(moduleKey);

  if (!descriptor) {
    return null;
  }

  const signals = await computeGenericSignals(
    tx,
    tenantId,
    descriptor,
    correlationId
  );

  return {
    moduleKey,
    status: classifyHealthStatus(signals),
    signals,
    generatedAt: new Date().toISOString()
  };
}

/**
 * Placeholder for a live, bounded, network-calling provider health check. No
 * module in this base declares an external provider yet, so this signal is
 * always `not_applicable` — but the seam is kept so a derived application (or
 * a future provider-backed base module) can add a real, timeout-bounded,
 * error-truncating check here. When one is added it must stay
 * `POST .../health/check`-only (never the passive `GET`), and its `detail`
 * must always be a fixed, generic string — never a raw provider error.
 */
async function providerHealthCheckSignal(): Promise<ReadinessSignal> {
  return { name: "provider_health_check", status: "not_applicable" };
}

/**
 * `awcms_module_health_checks` (migration 008) — instance-level history,
 * RLS-free (a health result is a fact about the deployed instance, not about
 * any one tenant), written only by the explicit `POST .../health/check`
 * action (never the passive `GET`, which would otherwise turn every admin
 * page view into a write). `message` is a fixed, safe summary of which signal
 * names failed — never a signal's own `detail` text.
 */
async function recordHealthCheckHistory(
  tx: Bun.SQL,
  moduleKey: string,
  report: ModuleHealthReport
): Promise<void> {
  const failedNames = report.signals
    .filter((signal) => signal.status === "fail")
    .map((signal) => signal.name);
  const message =
    failedNames.length > 0
      ? `Failed signals: ${failedNames.join(", ")}.`
      : null;

  await tx`
    INSERT INTO awcms_module_health_checks (module_key, status, message)
    VALUES (${moduleKey}, ${report.status}, ${message})
  `;
}

/**
 * The explicit, on-demand variant (`POST .../health/check`) — same generic
 * signals as `fetchModuleHealthReport`, plus the provider check where
 * applicable. Never called from `GET .../health`, which stays fast/cheap on
 * every call. Records its result into `awcms_module_health_checks` as a
 * history entry — that table has an FK to `awcms_modules`, so this syncs the
 * registry first (same "sync first" reasoning as
 * `tenant-module-lifecycle.ts`/`module-settings.ts`). This is the one place
 * `db_registry_synced` can genuinely read differently between `GET` and
 * `POST` for the same module — `POST` self-heals the registry as a side
 * effect of writing history, `GET` never does (stays a pure read).
 */
export async function runModuleHealthCheck(
  tx: Bun.SQL,
  tenantId: string,
  moduleKey: string,
  correlationId?: string
): Promise<ModuleHealthReport | null> {
  const descriptor = findDescriptor(moduleKey);

  if (!descriptor) {
    return null;
  }

  await syncModuleDescriptors(tx);

  const signals = await computeGenericSignals(
    tx,
    tenantId,
    descriptor,
    correlationId
  );
  signals.push(await providerHealthCheckSignal());

  const report: ModuleHealthReport = {
    moduleKey,
    status: classifyHealthStatus(signals),
    signals,
    generatedAt: new Date().toISOString()
  };

  await recordHealthCheckHistory(tx, moduleKey, report);

  return report;
}
