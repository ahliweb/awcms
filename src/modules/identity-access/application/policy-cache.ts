/**
 * Tenant-keyed ABAC policy cache (Issue #179).
 *
 * The authorization chokepoint (`authorizeInTransaction`) evaluates stored
 * policies on EVERY guarded request. Re-reading + re-parsing the policy table
 * on every call would be wasteful, so active policies are compiled once per
 * tenant and cached in-process. Correctness over speed: the cache is
 * invalidated DETERMINISTICALLY the moment a policy is created/updated/enabled/
 * disabled — every mutating endpoint (the DSL surface `/api/v1/access/policies`
 * AND the flat #171 surface `/api/v1/abac/policies`) calls
 * `invalidatePolicyCache(tenantId)` AFTER its transaction commits, bumping a
 * per-tenant version so the next load re-queries. No restart, no TTL races.
 *
 * WHAT IS EVALUATED: ONLY DSL-managed policies. `queryAndCompile` filters
 * `is_dsl_managed = true` (sql/031), so a row authored by the flat #171 CRUD
 * (which can set neither applicability nor a condition, and would otherwise
 * present as a wildcard, always-true policy — a flat `deny` bricking the whole
 * tenant) is NEVER loaded, compiled, or evaluated. That makes the flat surface's
 * own `invalidatePolicyCache` call a HARMLESS defensive no-op: flat rows are not
 * consumed, so there is no stale snapshot for them to correct. It is kept only
 * so the wiring stays uniform if a flat row is ever promoted to DSL-managed via
 * the DSL surface. See ADR-0033 §3.
 *
 * Tenant isolation: entries are keyed by tenant id and every DB read runs
 * inside `withTenant` (RLS-enforced, non-superuser `awcms_app` role in
 * production), so one tenant's cache entry can never contain another tenant's
 * policies. The cache never reads cross-tenant.
 *
 * Scope note (documented, ADR-0033 §Cache): invalidation is per-PROCESS. In a
 * single-instance deployment this is fully deterministic. A horizontally-scaled
 * deployment would additionally need a cross-instance signal (LISTEN/NOTIFY or
 * a short TTL) — called out as a limitation, not silently assumed away.
 */

import {
  ABAC_DSL_VERSION,
  parseAbacCondition,
  type AbacPolicyEffect
} from "../domain/abac-policy";
import type { CompiledPolicy } from "../domain/abac-evaluator";

type CacheEntry = {
  version: number;
  policies: CompiledPolicy[];
};

const cache = new Map<string, CacheEntry>();
const versions = new Map<string, number>();

/** Current cache version for a tenant (0 before any invalidation). Exposed for
 * observability and tests asserting deterministic invalidation. */
export function getPolicyCacheVersion(tenantId: string): number {
  return versions.get(tenantId) ?? 0;
}

/**
 * Invalidate a tenant's cached policies. Bumps the version and drops the entry
 * so the next `loadActivePolicies` re-queries. Call this from every endpoint
 * that creates/updates/enables/disables a policy, AFTER the mutating
 * transaction commits (so a committed change is always visible to the next
 * request and a concurrent read can never re-cache a pre-commit snapshot).
 */
export function invalidatePolicyCache(tenantId: string): void {
  versions.set(tenantId, (versions.get(tenantId) ?? 0) + 1);
  cache.delete(tenantId);
}

/** Test-only: clear all cached policies and versions. */
export function resetPolicyCache(): void {
  cache.clear();
  versions.clear();
}

type PolicyRow = {
  policy_code: string;
  effect: string;
  module_key: string | null;
  activity_code: string | null;
  action: string | null;
  resource_type: string | null;
  dsl_version: number;
  priority: number;
  conditions: unknown;
};

function compileRow(row: PolicyRow): CompiledPolicy {
  const applicability = {
    moduleKey: row.module_key,
    activityCode: row.activity_code,
    action: row.action,
    resourceType: row.resource_type
  };
  const base = {
    policyCode: row.policy_code,
    effect: row.effect as AbacPolicyEffect,
    dslVersion: row.dsl_version,
    priority: row.priority,
    applicability
  };

  // Fail-closed: a stored policy authored under a newer grammar than this build
  // understands is treated as INVALID (forces deny in its applicability), never
  // silently ignored.
  if (row.dsl_version > ABAC_DSL_VERSION) {
    return {
      ...base,
      condition: null,
      invalidReason: `dsl_version ${row.dsl_version} exceeds supported ${ABAC_DSL_VERSION}.`
    };
  }

  const parsed = parseAbacCondition(row.conditions);
  if (!parsed.valid) {
    return {
      ...base,
      condition: null,
      invalidReason: parsed.errors[0] ?? "Invalid condition."
    };
  }

  return { ...base, condition: parsed.node };
}

async function queryAndCompile(
  tx: Bun.SQL,
  tenantId: string
): Promise<CompiledPolicy[]> {
  const rows = (await tx`
    SELECT policy_code, effect, module_key, activity_code, action, resource_type,
           dsl_version, priority, conditions
    FROM awcms_abac_policies
    WHERE tenant_id = ${tenantId} AND is_active = true AND is_dsl_managed = true
    ORDER BY priority ASC, policy_code ASC
  `) as PolicyRow[];

  return rows.map(compileRow);
}

/**
 * Load (and cache) the tenant's ACTIVE, compiled policies. On a cache hit at
 * the current version, returns the memoized list with zero I/O; on a miss,
 * queries within the caller's tenant transaction and memoizes. The returned
 * list is treated as read-only by callers.
 */
export async function loadActivePolicies(
  tx: Bun.SQL,
  tenantId: string
): Promise<CompiledPolicy[]> {
  const version = versions.get(tenantId) ?? 0;
  const entry = cache.get(tenantId);
  if (entry && entry.version === version) {
    return entry.policies;
  }

  const policies = await queryAndCompile(tx, tenantId);
  cache.set(tenantId, { version, policies });
  return policies;
}
