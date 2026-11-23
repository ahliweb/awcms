/**
 * Tenant-keyed ABAC policy cache (Issue #179; cross-process since Issue #1482).
 *
 * The authorization chokepoint (`authorizeInTransaction`) evaluates stored
 * policies on EVERY guarded request. Re-reading + re-parsing the policy table
 * on every call would be wasteful, so active policies are compiled once per
 * tenant and cached in-process.
 *
 * ## Correctness comes from the DATABASE, not from this process (Issue #1482)
 *
 * Every cache entry is tagged with the tenant's POLICY VERSION — the value of
 * `awcms_abac_policy_versions.policy_version` (sql/432). A trigger on
 * `awcms_abac_policies` writes a fresh, never-reused value into that row in the
 * SAME transaction as any INSERT, UPDATE, DELETE or TRUNCATE, whichever code
 * path (DSL surface, flat #171 surface, a migration, an operator) made it.
 *
 * `loadActivePolicies` is given — or reads — the version INSIDE the caller's
 * transaction and serves the cached list only when the tags are EQUAL. Any
 * difference means somebody, in some process, changed the tenant's policies
 * since the snapshot was taken, and the snapshot is dropped. So a new `deny`
 * or a disabled `allow` committed by process A is honoured by process B's very
 * next authorization: no TTL, no restart, no NOTIFY that a reconnect can lose.
 *
 * Why a stale snapshot can never be tagged FRESH: the version is read BEFORE
 * the policies (same statement order in every caller; in the chokepoint it
 * rides on the principal query, which runs first). Under READ COMMITTED a later
 * statement sees a state at least as new as an earlier one, so the policies
 * stored under version V are never OLDER than V. The opposite race — policies
 * newer than their tag — only costs one unnecessary reload on the next call.
 *
 * Missing row = version `"0"`. A tenant reads `"0"` only while no policy write
 * has happened since its row was created or last vanished; the first write
 * after that writes a sequence value (always > 0), so `"0"` can never match a
 * snapshot taken across a change.
 *
 * `invalidatePolicyCache(tenantId)` is kept as a LOCAL optimisation: the writing
 * process drops its entry right after commit instead of waiting for the next
 * version comparison. It is no longer what makes the cache correct, and a
 * writer that forgets it is only slower, never wrong.
 *
 * ## What is evaluated
 *
 * ONLY DSL-managed policies. `queryAndCompile` filters `is_dsl_managed = true`
 * (sql/031), so a row authored by the flat #171 CRUD (which can set neither
 * applicability nor a condition, and would otherwise present as a wildcard,
 * always-true policy — a flat `deny` bricking the whole tenant) is NEVER
 * loaded, compiled, or evaluated. The trigger still bumps the version for flat
 * writes; that costs a reload and keeps "every write invalidates" true without
 * a carve-out. See ADR-0033 §3.
 *
 * Tenant isolation: entries are keyed by tenant id and every DB read runs
 * inside `withTenant` (RLS-enforced, non-superuser `awcms_app` role in
 * production), so one tenant's cache entry can never contain another tenant's
 * policies. The cache never reads cross-tenant.
 */

import {
  ABAC_DSL_VERSION,
  parseAbacCondition,
  type AbacPolicyEffect
} from "../domain/abac-policy";
import type { CompiledPolicy } from "../domain/abac-evaluator";

type CacheEntry = {
  /** `awcms_abac_policy_versions.policy_version` the snapshot was taken at. */
  version: string;
  policies: CompiledPolicy[];
};

const cache = new Map<string, CacheEntry>();

/**
 * Invalidate a tenant's cached policies IN THIS PROCESS. A local optimisation
 * only (see the header): every other process learns of the change from the
 * database version. Call it from an endpoint that changed a policy, AFTER its
 * transaction commits.
 */
export function invalidatePolicyCache(tenantId: string): void {
  cache.delete(tenantId);
}

/** Test-only: clear all cached policies. */
export function resetPolicyCache(): void {
  cache.clear();
}

/**
 * The tenant's current ABAC policy version, read in the caller's transaction.
 * `"0"` when the tenant has no version row (no policy write since the row was
 * created or last vanished). Returned as text: the column is `bigint`, and
 * only equality is ever asked of it.
 */
export async function readPolicyVersion(
  tx: Bun.SQL,
  tenantId: string
): Promise<string> {
  const rows = (await tx`
    SELECT policy_version::text AS policy_version
    FROM awcms_abac_policy_versions
    WHERE tenant_id = ${tenantId}
  `) as { policy_version: string }[];

  return rows[0]?.policy_version ?? "0";
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
 * Load (and cache) the tenant's ACTIVE, compiled policies.
 *
 * `observedVersion` is the tenant's policy version as the CALLER already read
 * it in this transaction — the chokepoint gets it for free from the principal
 * query (`ResolvedTenantPrincipal.abacPolicyVersion`). When absent, it is read
 * here, one indexed primary-key lookup. Either way the cached list is served
 * only when its tag EQUALS that version; otherwise the policies are queried
 * within the caller's tenant transaction and re-memoized under the version.
 * The returned list is treated as read-only by callers.
 */
export async function loadActivePolicies(
  tx: Bun.SQL,
  tenantId: string,
  observedVersion?: string
): Promise<CompiledPolicy[]> {
  const version = observedVersion ?? (await readPolicyVersion(tx, tenantId));
  const entry = cache.get(tenantId);
  if (entry && entry.version === version) {
    return entry.policies;
  }

  const policies = await queryAndCompile(tx, tenantId);
  cache.set(tenantId, { version, policies });
  return policies;
}
