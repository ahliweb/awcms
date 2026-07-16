/**
 * Read-side aggregator (Issue #753) — combines a projection's code-declared
 * descriptor metadata with its live persisted state/metrics/freshness for
 * the `GET /api/v1/reports/projections[/​{key}]` API and admin UI. A
 * projection is a DERIVED read model, never an authorization source of
 * truth (issue #753 security requirement) — every function here only
 * READS; callers must independently re-check RBAC/ABAC before calling
 * (every route in `src/pages/api/v1/reports/projections*.ts` does, via the
 * same `authorizeInTransaction` guard every other endpoint in this repo
 * uses).
 *
 * TWO LAYERS of permission enforcement, deliberately:
 * 1. The route's own `authorizeInTransaction` call gates the coarse
 *    `reporting.projections.read` (or `.analyze`) permission — same as
 *    every other endpoint in this repo.
 * 2. `grantedPermissionKeys` is ALSO threaded into every function below,
 *    which additionally filters/rejects by each individual descriptor's
 *    OWN `requiredPermission` (`ProjectionDescriptor.requiredPermission`,
 *    `_shared/module-contract.ts`) — same "filter by the candidate's own
 *    declared permission, not just the coarse endpoint gate" pattern
 *    `module-management/domain/navigation-registry.ts`'s
 *    `filterVisibleNavigationEntries` already establishes for admin nav.
 *    All three descriptors registered in this PR happen to share the
 *    SAME `requiredPermission` value, so layer 1 alone was not
 *    exploitable today — but the moment a future module registers a
 *    projection with a narrower permission, layer 2 is what actually
 *    stops a caller holding only the coarse gate from seeing it anyway
 *    (reviewer finding, PR #781).
 */
import { computeProjectionFreshness } from "../domain/freshness";
import { collectProjectionDescriptors } from "../domain/projection-registry";
import {
  filterPermittedProjectionDescriptors,
  isProjectionPermitted
} from "../domain/projection-permission-filter";
import { listModules } from "../../index";
import type { ProjectionDescriptor } from "../../_shared/module-contract";
import { getProjectionMetrics } from "./projection-metric-store";
import { getProjectionState } from "./projection-state-store";
import { findRunningRebuild } from "./rebuild-run-store";
import { listReconciliationRuns } from "./reconciliation-run-store";

export type ProjectionSummaryView = {
  key: string;
  version: number;
  ownerModuleKey: string;
  scope: string;
  description: string;
  metricLabels: Readonly<Record<string, string>>;
  metrics: Record<string, number>;
  freshness: {
    status: string;
    ageSeconds: number | null;
    lastSuccessAt: string | null;
    lastAttemptAt: string | null;
    consecutiveFailures: number;
    lastErrorMessage: string | null;
  };
  drillDownPath: string | null;
};

export function listRegisteredProjectionDescriptors(): ProjectionDescriptor[] {
  return collectProjectionDescriptors(listModules());
}

export function findProjectionDescriptor(
  key: string
): ProjectionDescriptor | undefined {
  return listRegisteredProjectionDescriptors().find(
    (descriptor) => descriptor.key === key
  );
}

async function buildSummaryView(
  tx: Bun.SQL,
  tenantId: string,
  descriptor: ProjectionDescriptor,
  now: Date
): Promise<ProjectionSummaryView> {
  // Sequential, NOT `Promise.all` — every call below issues a query on
  // the SAME transaction/connection (`tx`); a single Postgres connection
  // processes one query at a time, and running these concurrently
  // produced a real hang in this repo (see `projection-reconciliation.ts`'s
  // matching comment for the confirmed empirical failure).
  const metrics = await getProjectionMetrics(tx, tenantId, descriptor.key);
  const state = await getProjectionState(tx, tenantId, descriptor.key);
  const runningRebuild = await findRunningRebuild(tx, tenantId, descriptor.key);

  const freshness = computeProjectionFreshness(
    { ...state, rebuildInProgress: runningRebuild !== null },
    descriptor.freshness,
    now
  );

  return {
    key: descriptor.key,
    version: descriptor.version,
    ownerModuleKey: descriptor.ownerModuleKey,
    scope: descriptor.scope,
    description: descriptor.description,
    metricLabels: descriptor.metricLabels,
    metrics,
    freshness: {
      status: freshness.status,
      ageSeconds: freshness.ageSeconds,
      lastSuccessAt: freshness.lastSuccessAt?.toISOString() ?? null,
      lastAttemptAt: freshness.lastAttemptAt?.toISOString() ?? null,
      consecutiveFailures: freshness.consecutiveFailures,
      lastErrorMessage: freshness.lastErrorMessage
    },
    drillDownPath: descriptor.drillDownPath ?? null
  };
}

export async function listProjectionSummariesForTenant(
  tx: Bun.SQL,
  tenantId: string,
  grantedPermissionKeys: ReadonlySet<string>,
  now: Date = new Date()
): Promise<ProjectionSummaryView[]> {
  const descriptors = filterPermittedProjectionDescriptors(
    listRegisteredProjectionDescriptors(),
    grantedPermissionKeys
  );
  const views: ProjectionSummaryView[] = [];

  for (const descriptor of descriptors) {
    if (descriptor.scope !== "tenant") {
      // Known limitation (matches `data_lifecycle`'s own documented
      // scope): `scope: "global"` descriptors are accepted by the
      // registry validator (forward-compatible typing) but this read
      // path — and the incremental/rebuild engines — only implement the
      // `"tenant"` path end-to-end today. No registered descriptor
      // currently declares `scope: "global"`.
      continue;
    }
    views.push(await buildSummaryView(tx, tenantId, descriptor, now));
  }

  return views;
}

export type ProjectionSummaryLookupResult =
  | { outcome: "not_found" }
  | { outcome: "forbidden" }
  | {
      outcome: "found";
      summary: ProjectionSummaryView;
      recentReconciliations: Awaited<ReturnType<typeof listReconciliationRuns>>;
    };

export async function getProjectionSummaryForTenant(
  tx: Bun.SQL,
  tenantId: string,
  key: string,
  grantedPermissionKeys: ReadonlySet<string>,
  now: Date = new Date()
): Promise<ProjectionSummaryLookupResult> {
  const descriptor = findProjectionDescriptor(key);
  if (!descriptor || descriptor.scope !== "tenant") {
    return { outcome: "not_found" };
  }
  if (!isProjectionPermitted(descriptor, grantedPermissionKeys)) {
    // A SINGLE-item lookup for a descriptor that genuinely exists but the
    // caller lacks THIS descriptor's own permission for — 403, not 404,
    // matching this repo's existing convention of never disguising a
    // permission denial as a generic "not found" (see every
    // `authorizeInTransaction`-gated route's own `403 ACCESS_DENIED`).
    return { outcome: "forbidden" };
  }

  // Sequential — same same-connection reasoning as `buildSummaryView`'s
  // own comment above.
  const summary = await buildSummaryView(tx, tenantId, descriptor, now);
  const recentReconciliations = await listReconciliationRuns(tx, tenantId, key);

  return { outcome: "found", summary, recentReconciliations };
}
