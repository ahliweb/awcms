/**
 * Resolves the bounded, I/O-derived business-scope facts
 * `domain/access-control.ts`'s `evaluateAccess` needs to stay pure (Issue
 * #180, epic #177 Wave 2 authorization). Ported from awcms-mini
 * (`identity-access/application/business-scope-facts.ts`, Issue #746),
 * REDUCED to the generic scope-fact resolver only.
 *
 * `resolveBusinessScopeFacts` returns the `(scopeType, scopeId)` scopes the
 * subject currently holds ANY active assignment for (regardless of
 * role/permission), each ENRICHED with the hierarchy resolution from the
 * injected `BusinessScopeHierarchyPort` (ancestors/descendants for
 * descendant/ancestor coverage; `resolved` for the fail-closed high-risk
 * gate). These feed `evaluateAccess`'s optional `businessScopeFacts`
 * parameter (a route opts a request in via
 * `resourceAttributes.requiredScopeType`/`.requiredScopeId`).
 *
 * SoD facts (#181, filled from mini): this file ALSO exports the
 * permission-keyed facts that segregation-of-duties conflict detection
 * consumes — `resolveSoDAssignmentFacts` (merging BOTH the
 * business-scope-assignment path AND the ordinary RBAC role-grant path, see
 * `resolveOrdinaryRbacFacts`'s own header) and `resolveRolePermissionKeys`
 * (the keys a role would newly confer at assignment-create time). These feed
 * `domain/sod-conflict-evaluation.ts` (the pure matcher) via the
 * assignment-service SEAM and the `high-risk-sod-guard` chokepoint. #180
 * shipped only the generic scope resolver above; #181 adds these below without
 * changing anything above.
 */
import { isBusinessScopeAssignmentCurrentlyActive } from "../domain/business-scope-assignment";
import {
  TENANT_WIDE_SCOPE_TYPE,
  type BusinessScopeFact
} from "../domain/access-control";
import type { SoDAssignmentFact } from "../domain/sod-conflict-evaluation";
import type {
  BusinessScopeHierarchyPort,
  BusinessScopeResolution
} from "../../_shared/ports/business-scope-hierarchy-port";

const UNRESOLVED_RESULT: BusinessScopeResolution = {
  resolved: false,
  ancestorScopes: [],
  descendantScopes: []
};

// Fail-closed guard bounds for the DERIVED-app-provided hierarchy adapter
// (issue #180 review F1). Env-overridable, clamped to sane ranges.
const DEFAULT_HIERARCHY_RESOLVE_TIMEOUT_MS = 500;
const DEFAULT_HIERARCHY_MAX_RELATED_SCOPES = 5000;

function clampInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

type HierarchyGuardConfig = { timeoutMs: number; maxRelatedScopes: number };

function resolveHierarchyGuardConfig(): HierarchyGuardConfig {
  return {
    timeoutMs: clampInt(
      process.env.AUTH_BUSINESS_SCOPE_HIERARCHY_TIMEOUT_MS,
      DEFAULT_HIERARCHY_RESOLVE_TIMEOUT_MS,
      1,
      60_000
    ),
    maxRelatedScopes: clampInt(
      process.env.AUTH_BUSINESS_SCOPE_HIERARCHY_MAX_RELATED_SCOPES,
      DEFAULT_HIERARCHY_MAX_RELATED_SCOPES,
      0,
      1_000_000
    )
  };
}

/**
 * Fail-closed defense-in-depth around a DERIVED-app-provided hierarchy adapter
 * (issue #180 review F1). Base-side, the adapter is UNTRUSTED — it may be buggy
 * or hostile — so its output is bounded two ways before it can widen access:
 *
 * - WALL-CLOCK TIMEOUT (`AUTH_BUSINESS_SCOPE_HIERARCHY_TIMEOUT_MS`, default
 *   500ms): if the adapter does not resolve in time, the scope is treated as
 *   `resolved: false` (deny hierarchy coverage), NEVER as coverage. **Honest
 *   limit (ADR-0030):** this only bounds an adapter that AWAITS I/O (e.g. a
 *   SQL query — which Postgres `statement_timeout` independently caps). A
 *   purely-SYNCHRONOUS CPU infinite loop inside the adapter cannot be
 *   interrupted from JavaScript — the event loop never regains control, so the
 *   timer never fires, and the `resolveScope()` call itself blocks before this
 *   race is even set up. That case remains the derived app's own
 *   responsibility.
 * - COMBINED-LENGTH CAP (`AUTH_BUSINESS_SCOPE_HIERARCHY_MAX_RELATED_SCOPES`,
 *   default 5000): if `ancestorScopes.length + descendantScopes.length`
 *   exceeds the bound, the scope is treated as `resolved: false` — a runaway
 *   adapter cannot flood the evaluator's per-fact coverage scan.
 */
async function resolveScopeGuarded(
  hierarchyPort: BusinessScopeHierarchyPort,
  tx: Bun.SQL,
  tenantId: string,
  scopeType: string,
  scopeId: string,
  config: HierarchyGuardConfig
): Promise<BusinessScopeResolution> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<BusinessScopeResolution>((resolve) => {
    timer = setTimeout(() => resolve(UNRESOLVED_RESULT), config.timeoutMs);
  });

  try {
    const resolution = await Promise.race([
      hierarchyPort.resolveScope(tx, tenantId, scopeType, scopeId),
      timeout
    ]);

    if (
      resolution.resolved &&
      resolution.ancestorScopes.length + resolution.descendantScopes.length >
        config.maxRelatedScopes
    ) {
      return UNRESOLVED_RESULT;
    }

    return resolution;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

type ActiveAssignmentRow = {
  id: string;
  scope_type: string;
  scope_id: string;
  effective_from: Date;
  effective_to: Date | null;
  status: "active" | "expired" | "revoked";
};

async function fetchActiveAssignmentRows(
  tx: Bun.SQL,
  tenantId: string,
  tenantUserId: string
): Promise<ActiveAssignmentRow[]> {
  return (await tx`
    SELECT id, scope_type, scope_id, effective_from, effective_to, status
    FROM awcms_business_scope_assignments
    WHERE tenant_id = ${tenantId} AND tenant_user_id = ${tenantUserId}
      AND status = 'active'
  `) as ActiveAssignmentRow[];
}

/**
 * Resolves the subject's currently-in-force business-scope facts, each
 * enriched with hierarchy resolution from `hierarchyPort`. `status = 'active'`
 * rows whose effective dating has NOT yet started or has already elapsed are
 * excluded here (via `isBusinessScopeAssignmentCurrentlyActive`), so an
 * assignment revoked or expired a millisecond ago stops covering IMMEDIATELY —
 * no cache, no wait for the batch expiry job (issue #180: "Revocation/expiry
 * langsung memengaruhi authorization").
 *
 * The hierarchy port is called once per DISTINCT held scope (deduplicated
 * first) — a subject with many assignments to the same scope costs one
 * resolution, not N. Sequential awaits over the single `tx` (never
 * `Promise.all`): one Postgres connection serves one query at a time.
 */
export async function resolveBusinessScopeFacts(
  tx: Bun.SQL,
  tenantId: string,
  tenantUserId: string,
  now: Date,
  hierarchyPort: BusinessScopeHierarchyPort
): Promise<BusinessScopeFact[]> {
  const rows = await fetchActiveAssignmentRows(tx, tenantId, tenantUserId);
  const facts: BusinessScopeFact[] = [];
  const seen = new Set<string>();
  const guardConfig = resolveHierarchyGuardConfig();

  for (const row of rows) {
    if (
      !isBusinessScopeAssignmentCurrentlyActive(
        {
          status: row.status,
          effectiveFrom: row.effective_from,
          effectiveTo: row.effective_to
        },
        now
      )
    ) {
      continue;
    }

    const dedupeKey = `${row.scope_type}:${row.scope_id}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    // A tenant-wide grant (reserved scope type) is intrinsic — it needs no
    // hierarchy resolution and always covers, so it is trusted (`resolved`)
    // by construction.
    if (row.scope_type === TENANT_WIDE_SCOPE_TYPE) {
      facts.push({
        scopeType: row.scope_type,
        scopeId: row.scope_id,
        resolved: true,
        ancestorScopes: [],
        descendantScopes: [],
        tenantWide: true
      });
      continue;
    }

    const resolution = await resolveScopeGuarded(
      hierarchyPort,
      tx,
      tenantId,
      row.scope_type,
      row.scope_id,
      guardConfig
    );

    // `resolved: false` NEVER contributes ancestor/descendant coverage — the
    // arrays are forced empty regardless of what an adapter returned, so a
    // buggy/hostile adapter that sets `resolved: false` with a non-empty list
    // cannot widen access (defense in depth on top of the port contract).
    facts.push({
      scopeType: row.scope_type,
      scopeId: row.scope_id,
      resolved: resolution.resolved,
      ancestorScopes: resolution.resolved ? resolution.ancestorScopes : [],
      descendantScopes: resolution.resolved ? resolution.descendantScopes : [],
      tenantWide: false
    });
  }

  return facts;
}

// ===========================================================================
// SoD facts (#181) — permission-keyed facts for `sod-conflict-evaluation.ts`.
// ===========================================================================

type AssignmentPermissionRow = {
  scope_type: string;
  scope_id: string;
  effective_from: Date;
  effective_to: Date | null;
  status: "active" | "expired" | "revoked";
  module_key: string;
  activity_code: string;
  action: string;
};

type OrdinaryRbacPermissionRow = {
  module_key: string;
  activity_code: string;
  action: string;
};

/**
 * Permissions the subject holds via an ORDINARY RBAC role grant
 * (`awcms_access_assignments` -> `awcms_role_permissions` ->
 * `awcms_permissions`) — the exact same path `auth-context.ts`'s
 * `fetchGrantedPermissionKeys` already reads for every ordinary ABAC decision.
 * SoD conflict detection MUST reason about this path (not only the
 * business-scope-assignment path), or it is blind to the realistic, common
 * case where a subject holds BOTH halves of a registered conflict through an
 * ordinary role (e.g. the setup wizard's "owner" role, which grants every
 * permission in the tenant). Returned facts have `scopeType`/`scopeId: null` —
 * an ordinary role grant is not confined to any business scope, so
 * `detectSoDConflicts` treats it as conflicting at EVERY requested scope for a
 * `"same_scope_only"` rule (see `sod-conflict-evaluation.ts`'s
 * `SoDAssignmentFact` doc comment).
 */
async function resolveOrdinaryRbacFacts(
  tx: Bun.SQL,
  tenantId: string,
  tenantUserId: string
): Promise<SoDAssignmentFact[]> {
  const rows = (await tx`
    SELECT DISTINCT p.module_key, p.activity_code, p.action
    FROM awcms_access_assignments aa
    JOIN awcms_role_permissions rp ON rp.role_id = aa.role_id AND rp.tenant_id = aa.tenant_id
    JOIN awcms_permissions p ON p.id = rp.permission_id
    JOIN awcms_roles r ON r.id = aa.role_id
    WHERE aa.tenant_id = ${tenantId} AND aa.tenant_user_id = ${tenantUserId}
      AND r.deleted_at IS NULL
  `) as OrdinaryRbacPermissionRow[];

  return rows.map((row) => ({
    permissionKey: `${row.module_key}.${row.activity_code}.${row.action}`,
    scopeType: null,
    scopeId: null
  }));
}

/**
 * The subject's currently-in-force SoD facts (`(permissionKey, scopeType,
 * scopeId)` triples) that conflict detection reasons about. Merges TWO sources
 * (see `resolveOrdinaryRbacFacts`'s header for why the second is required):
 * the business-scope-assignment-granted permissions (each carrying that
 * assignment's real scope) PLUS the subject's ordinary RBAC-granted
 * permissions (`scopeType`/`scopeId: null`).
 *
 * `excludeAssignmentId` lets `assignment_create` conflict evaluation check the
 * subject's OTHER existing active assignments without a not-yet-committed row
 * interfering. Effective-dated rows whose window has not started / already
 * elapsed are excluded via `isBusinessScopeAssignmentCurrentlyActive` — an
 * assignment expired/revoked a millisecond ago stops contributing IMMEDIATELY
 * (no cache; issue #181 "Exception expired/revoked langsung tidak berlaku"
 * mirrors #180's assignment revocation immediacy). Sequential awaits over the
 * single `tx` (never `Promise.all`): one Postgres connection serves one query
 * at a time — the bounded, non-N+1 query count issue #181 requires (exactly
 * two SELECTs regardless of how many permissions/assignments the subject has).
 */
export async function resolveSoDAssignmentFacts(
  tx: Bun.SQL,
  tenantId: string,
  tenantUserId: string,
  now: Date,
  excludeAssignmentId: string | null = null
): Promise<SoDAssignmentFact[]> {
  const rows = (await tx`
    SELECT bsa.scope_type, bsa.scope_id, bsa.effective_from, bsa.effective_to, bsa.status,
      p.module_key, p.activity_code, p.action
    FROM awcms_business_scope_assignments bsa
    JOIN awcms_role_permissions rp
      ON rp.role_id = bsa.role_id AND rp.tenant_id = bsa.tenant_id
    JOIN awcms_permissions p ON p.id = rp.permission_id
    WHERE bsa.tenant_id = ${tenantId} AND bsa.tenant_user_id = ${tenantUserId}
      AND bsa.status = 'active' AND bsa.role_id IS NOT NULL
      AND (${excludeAssignmentId}::uuid IS NULL OR bsa.id <> ${excludeAssignmentId})
  `) as AssignmentPermissionRow[];

  const facts: SoDAssignmentFact[] = [];

  for (const row of rows) {
    if (
      !isBusinessScopeAssignmentCurrentlyActive(
        {
          status: row.status,
          effectiveFrom: row.effective_from,
          effectiveTo: row.effective_to
        },
        now
      )
    ) {
      continue;
    }

    facts.push({
      permissionKey: `${row.module_key}.${row.activity_code}.${row.action}`,
      scopeType: row.scope_type,
      scopeId: row.scope_id
    });
  }

  facts.push(...(await resolveOrdinaryRbacFacts(tx, tenantId, tenantUserId)));

  return facts;
}

/**
 * The permission keys `roleId` grants — used at assignment-CREATE time to know
 * which permission keys the NOT-YET-created assignment would newly confer at
 * its scope, so SoD conflict detection can check each one against the
 * subject's OTHER already-active assignment facts.
 */
export async function resolveRolePermissionKeys(
  tx: Bun.SQL,
  tenantId: string,
  roleId: string
): Promise<string[]> {
  const rows = (await tx`
    SELECT DISTINCT p.module_key, p.activity_code, p.action
    FROM awcms_role_permissions rp
    JOIN awcms_permissions p ON p.id = rp.permission_id
    WHERE rp.tenant_id = ${tenantId} AND rp.role_id = ${roleId}
  `) as { module_key: string; activity_code: string; action: string }[];

  return rows.map(
    (row) => `${row.module_key}.${row.activity_code}.${row.action}`
  );
}
