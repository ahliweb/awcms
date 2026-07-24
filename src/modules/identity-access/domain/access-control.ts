import {
  AbacEvaluationError,
  evaluateAbacPolicies,
  type AbacEnvironment,
  type CompiledPolicy
} from "./abac-evaluator";

export type TenantContext = {
  tenantId: string;
  tenantUserId: string;
  identityId: string;
  roles: string[];
  /** Issue #179 — acting subject's default office id, exposed to the ABAC DSL
   * as `subject.defaultOfficeId` (may be absent; no base resolver populates it
   * yet, so it resolves as absent until a deployment wires one). Optional and
   * additive: no existing call site sets it and every leaf referencing it is
   * simply false while unset. */
  defaultOfficeId?: string;
  correlationId?: string;
};

/**
 * Grows one literal at a time as a real endpoint needs it (same convention
 * as `awcms-mini`'s own `identity-access/domain/access-control.ts`) — never
 * pre-declare an action for a module that doesn't exist yet.
 */
export type AccessAction =
  | "read"
  | "create"
  | "update"
  | "delete"
  | "approve"
  | "assign"
  | "configure"
  | "restore"
  | "purge"
  | "retry"
  | "sync"
  | "enable"
  | "disable"
  | "check"
  | "replay"
  | "manage"
  // Workflow-approval actions (ported alongside the workflow module).
  | "publish"
  | "retire"
  | "cancel"
  | "reassign"
  | "force_decide"
  | "revoke"
  // Reporting actions (ported alongside the reporting module): `rebuild`
  // and `export` mutate/produce artifacts (high-risk); `analyze` is a
  // read-only reconciliation analysis (not high-risk, same posture as a
  // dry-run).
  | "rebuild"
  | "analyze"
  | "export"
  // MFA administration (Issue #184): `reset` disables another user's factor
  // (high-risk); `configure` sets the tenant MFA enforcement policy.
  | "reset"
  // SoD exception decision (Issue #181): `reject` denies a pending
  // segregation-of-duties conflict exception request. Deliberately NOT
  // high-risk — rejecting an exception is the SAFE outcome (the conflict stays
  // denied), unlike `approve`/`revoke` which change an override's standing.
  // (`approve`/`revoke` for exceptions reuse the existing high-risk actions.)
  | "reject"
  // Theming (ADR-0034 Fase 3): `archive` retires the active theme so the site
  // falls back to the default. High-risk (it changes the live public
  // presentation surface), same posture as `publish`/`restore`.
  | "archive"
  // Blog content (ported from awcms-mini): `schedule` sets a post/page's
  // future `scheduled_at` (high-risk, same posture as `publish` — it commits
  // to a future state transition). `preview` is read-only (previews the
  // automatic internal tag linking transform for a post before publishing,
  // not itself a mutation).
  | "schedule"
  | "preview"
  // News portal (ported from awcms-mini): `verify` finalizes an uploaded news
  // media object (flips its status based on server-side MIME/checksum
  // verification). Deliberately NOT in `HIGH_RISK_ACTIONS` — it only advances
  // a media object's own status, does not delete or irreversibly change data;
  // the finalize endpoint still requires `Idempotency-Key` and is audited
  // regardless of this classification (`isHighRiskAction` is metadata, not a
  // gate on idempotency/audit). (`attach`/`detach`/`delete`/`restore`/`purge`/
  // `cancel` are also seeded in the `news_portal.media` permission catalog but
  // reuse existing union members / are not yet authorized by any ported route.)
  | "verify"
  // Tenant domain (ported from awcms-micro epic #555): `set_primary` atomically
  // makes a verified tenant domain the active primary. Deliberately NOT in
  // `HIGH_RISK_ACTIONS` (same posture as `verify` — it only flips one row's
  // primary flag, does not delete or irreversibly change data); the set-primary
  // endpoint still requires `Idempotency-Key` and is audited regardless of this
  // classification. (`read`/`create`/`update`/`delete`/`verify` for
  // tenant_domain reuse existing union members.)
  | "set_primary";

export type AccessRequest = {
  moduleKey: string;
  activityCode: string;
  action: AccessAction;
  resourceType?: string;
  resourceId?: string;
  /**
   * Issue #180 — `resourceAttributes.requiredScopeType`/`.requiredScopeId`
   * (both `string`, set together) are an ADDITIVE opt-in: when present,
   * `evaluateAccess` ALSO requires the caller to hold a resolved
   * business-scope fact covering that `(scopeType, scopeId)` pair (see the
   * `businessScopeFacts` param below), denying otherwise. Absent (the default
   * for every pre-existing `AccessRequest` call site) means "no
   * business-scope constraint on this request" — behavior is completely
   * unchanged for every endpoint that does not opt in.
   *
   * `resourceAttributes.requiredScopeRelations` (optional `string[]`, a
   * subset of `"exact"`/`"descendant"`/`"ancestor"`) selects which hierarchy
   * relations satisfy the requirement — defaults to `["exact"]` (the
   * strictest). A tenant-wide grant always satisfies it regardless. See
   * `BusinessScopeFact` for the exact coverage semantics.
   */
  resourceAttributes?: Record<string, unknown>;
};

export type AccessDecision = {
  allowed: boolean;
  reason: string;
  matchedPolicy?: string;
  /** Issue #179 — the `dsl_version` of the stored ABAC policy that produced
   * this decision, when one did. Built-in guards (tenant_isolation, etc.)
   * leave this undefined. Recorded on the decision log. */
  matchedPolicyVersion?: number;
};

/** A `(scopeType, scopeId)` reference — the generic scope address used everywhere in the business-scope layer (Issue #180). */
export type BusinessScopeReference = {
  scopeType: string;
  scopeId: string;
};

/** The scope relations a required-scope check can accept (Issue #180). */
export type BusinessScopeRelation = "exact" | "descendant" | "ancestor";

/**
 * The reserved `scopeType` denoting a TENANT-WIDE grant. A business-scope
 * assignment whose `scopeType` is this value is not confined to any single
 * scope — it covers every required scope in the tenant (the "tenant-wide"
 * relation of issue #180). `scopeId` for such a fact is conventionally the
 * tenant id, but coverage does not depend on it.
 */
export const TENANT_WIDE_SCOPE_TYPE = "tenant";

/**
 * One resolved-and-verified business-scope fact for the acting subject —
 * always produced ahead of time by a caller via `BusinessScopeHierarchyPort`/
 * `application/business-scope-facts.ts` (I/O), NEVER resolved inside this
 * file (`evaluateAccess` stays pure, no I/O, matching every other ABAC
 * decision in this module).
 *
 * Coverage of a required `(scopeType, scopeId)` by a set of these facts
 * (Issue #180 scope relations):
 * - `tenantWide`  — a tenant-wide grant covers EVERY required scope.
 * - `exact`       — the subject holds an assignment to exactly the required
 *                   scope. For HIGH-RISK actions the held scope must still be
 *                   `resolved` (a deleted/stale scope must not authorize a
 *                   high-risk action — fail-closed, issue #180).
 * - `descendant`  — the required scope is a DESCENDANT of a scope the subject
 *                   holds (i.e. the held scope is an ancestor of it). Only a
 *                   `resolved` fact carries a non-empty `descendantScopes`, so
 *                   an unresolved/stale hierarchy can never widen access.
 * - `ancestor`    — the required scope is an ANCESTOR of a scope the subject
 *                   holds. Same `resolved`-gated safety as `descendant`.
 */
export type BusinessScopeFact = {
  scopeType: string;
  scopeId: string;
  /** Whether the held scope's hierarchy was resolvable by the `BusinessScopeHierarchyPort` at fact-resolution time. `false` ⇒ no ancestor/descendant coverage, and no exact coverage for high-risk actions. */
  resolved: boolean;
  /** Ancestor references of the held scope — only ever non-empty when `resolved` is `true`. */
  ancestorScopes: readonly BusinessScopeReference[];
  /** Descendant references of the held scope — only ever non-empty when `resolved` is `true`. */
  descendantScopes: readonly BusinessScopeReference[];
  /** Whether this fact is a tenant-wide grant (`scopeType === TENANT_WIDE_SCOPE_TYPE`), covering every required scope. */
  tenantWide: boolean;
};

const HIGH_RISK_ACTIONS: ReadonlySet<AccessAction> = new Set([
  "delete",
  "approve",
  "assign",
  "configure",
  "restore",
  "purge",
  "sync",
  "enable",
  "disable",
  "replay",
  "manage",
  "publish",
  "retire",
  "cancel",
  "reassign",
  "force_decide",
  "revoke",
  "rebuild",
  "export",
  "archive"
]);

export function isHighRiskAction(action: AccessAction): boolean {
  return HIGH_RISK_ACTIONS.has(action);
}

export function permissionKey(
  moduleKey: string,
  activityCode: string,
  action: string
): string {
  return `${moduleKey}.${activityCode}.${action}`;
}

function scopeListContains(
  list: readonly BusinessScopeReference[],
  scopeType: string,
  scopeId: string
): boolean {
  return list.some(
    (scope) => scope.scopeType === scopeType && scope.scopeId === scopeId
  );
}

/**
 * Which scope relations satisfy a required-scope check. Defaults to `exact`
 * only (the strictest, matching the pre-#180 exact-match behavior) when the
 * request supplies no `requiredScopeRelations`, and can never be empty (an
 * empty/garbage list still enforces at least `exact`, never "no constraint").
 */
function normalizeScopeRelations(
  raw: unknown
): ReadonlySet<BusinessScopeRelation> {
  if (!Array.isArray(raw)) {
    return new Set<BusinessScopeRelation>(["exact"]);
  }
  const relations = new Set<BusinessScopeRelation>();
  for (const value of raw) {
    if (value === "exact" || value === "descendant" || value === "ancestor") {
      relations.add(value);
    }
  }
  if (relations.size === 0) {
    relations.add("exact");
  }
  return relations;
}

/**
 * Issue #179 — optional stored-policy input passed by the application guard.
 * When omitted (or `policies` empty) the dynamic ABAC layer is a NO-OP and
 * `evaluateAccess` behaves exactly as before: every pre-existing call site that
 * supplies ≤4 arguments is completely unaffected. `env` is injected so the
 * evaluator stays pure and deterministic (no clock read inside the domain).
 */
export type AbacEvaluationInput = {
  policies: readonly CompiledPolicy[];
  env: AbacEnvironment;
};

/**
 * Default deny, deny overrides allow. Built-in hard guards (tenant isolation,
 * self-approval, force-decision, business-scope #180) run first and
 * short-circuit. Then the dynamic ABAC layer (Issue #179):
 *
 *   1. An explicit DENY policy whose condition matches → DENY (overrides RBAC
 *      allow and any allow-policy — "explicit deny wins"). An applicable but
 *      INVALID stored policy, or any evaluation error, also → DENY (fail-closed).
 *   2. The RBAC permission is STILL REQUIRED; an allow-policy never creates a
 *      permission the subject lacks.
 *   3. Applicable ALLOW policies act as an additional CONSTRAINT on the
 *      already-granted permission: if any allow-policy is applicable, at least
 *      one must be satisfied, else DENY. No applicable policy → ABAC is a no-op
 *      and RBAC decides.
 *
 * The #181 segregation-of-duties high-risk guard remains in the application
 * chokepoint (`authorizeInTransaction`), additive AFTER this decision.
 */
export function evaluateAccess(
  context: TenantContext,
  request: AccessRequest,
  grantedPermissionKeys: ReadonlySet<string>,
  businessScopeFacts?: readonly BusinessScopeFact[],
  abac?: AbacEvaluationInput
): AccessDecision {
  const resourceTenantId = request.resourceAttributes?.tenantId;

  if (resourceTenantId !== undefined && resourceTenantId !== context.tenantId) {
    return {
      allowed: false,
      reason: "Resource belongs to a different tenant.",
      matchedPolicy: "tenant_isolation"
    };
  }

  // Self-approval guard (ported alongside workflow-approval). When a caller
  // opts a request into it by supplying `requestedByTenantUserId`, an actor
  // may never approve a request they themselves filed. Two directions are
  // covered: the ordinary `approve` action, and the administrative
  // `force_decide` override (which bypasses quorum entirely — a caller who
  // filed their own instance AND holds `workflow.recovery.force_decide`
  // would otherwise be able to force-approve their own request, structurally
  // bypassing the `approve`-only check). No pre-existing call site sets
  // `requestedByTenantUserId`, so this is inert for every other endpoint.
  const requestedBy = request.resourceAttributes?.requestedByTenantUserId;

  if (
    (request.action === "approve" || request.action === "force_decide") &&
    requestedBy !== undefined &&
    requestedBy === context.tenantUserId
  ) {
    return {
      allowed: false,
      reason:
        request.action === "approve"
          ? "Self-approval is not allowed."
          : "Self-administered force-decision is not allowed.",
      matchedPolicy: "self_approval_deny"
    };
  }

  // Issue #180 — additive business-scope constraint. Only evaluated when a
  // caller opts a request into it via `requiredScopeType`/`requiredScopeId`
  // (see `AccessRequest`'s own doc comment); every pre-existing call site that
  // never sets these two fields is completely unaffected. The subject's
  // resolved `businessScopeFacts` are produced by the caller ahead of time
  // (`application/business-scope-facts.ts`); this function stays pure.
  //
  // Default-deny when no fact covers the required scope — "unresolved scope
  // ... default to deny for high-risk actions" (issue #180 security model),
  // applied here even for non-high-risk actions that explicitly opt in, since
  // declaring a required scope at all is itself an explicit request for this
  // guarantee.
  const requiredScopeType = request.resourceAttributes?.requiredScopeType;
  const requiredScopeId = request.resourceAttributes?.requiredScopeId;

  if (
    typeof requiredScopeType === "string" &&
    typeof requiredScopeId === "string"
  ) {
    const relations = normalizeScopeRelations(
      request.resourceAttributes?.requiredScopeRelations
    );
    const highRisk = isHighRiskAction(request.action);
    const facts = businessScopeFacts ?? [];

    const covered = facts.some((fact) => {
      // Tenant-wide grant (reserved "tenant" scope type) covers every scope.
      if (fact.tenantWide) {
        return true;
      }

      // Hierarchy-derived coverage: the required scope is a descendant or an
      // ancestor of a scope the subject holds. Only a RESOLVED fact carries a
      // non-empty ancestor/descendant list, so an unresolved/stale hierarchy
      // can never widen access this way — fail-closed by construction.
      if (
        relations.has("descendant") &&
        scopeListContains(
          fact.descendantScopes,
          requiredScopeType,
          requiredScopeId
        )
      ) {
        return true;
      }
      if (
        relations.has("ancestor") &&
        scopeListContains(
          fact.ancestorScopes,
          requiredScopeType,
          requiredScopeId
        )
      ) {
        return true;
      }

      // Exact coverage: the subject holds an active assignment to exactly this
      // scope. For HIGH-RISK actions the held scope must still be RESOLVED — a
      // deleted/stale scope must not authorize a high-risk action. This is the
      // `resolved: false -> deny` fail-closed predicate (issue #180).
      if (
        relations.has("exact") &&
        fact.scopeType === requiredScopeType &&
        fact.scopeId === requiredScopeId
      ) {
        if (highRisk && !fact.resolved) {
          return false;
        }
        return true;
      }

      return false;
    });

    if (!covered) {
      return {
        allowed: false,
        reason:
          "Required business scope is not resolved or not assigned to this subject.",
        matchedPolicy: "business_scope_unresolved"
      };
    }
  }

  // Issue #179 — dynamic ABAC policy pass. Runs only when the application guard
  // supplied active policies. Evaluated ONCE here; the deny/invalid parts take
  // effect BEFORE the RBAC check (deny overrides RBAC), the allow-constraint
  // part AFTER (an allow-policy only constrains a permission the subject already
  // holds). Any evaluation error → fail-closed DENY.
  let abacPass: ReturnType<typeof evaluateAbacPolicies> | undefined;

  if (abac && abac.policies.length > 0) {
    try {
      abacPass = evaluateAbacPolicies(
        abac.policies,
        context,
        request,
        abac.env
      );
    } catch (error) {
      if (error instanceof AbacEvaluationError) {
        return {
          allowed: false,
          reason: "ABAC policy evaluation failed; access denied (fail-closed).",
          matchedPolicy: "abac_evaluation_error"
        };
      }
      throw error;
    }

    if (abacPass.invalidMatch) {
      return {
        allowed: false,
        reason:
          "An active ABAC policy is invalid; access denied (fail-closed).",
        matchedPolicy: abacPass.invalidMatch.policyCode,
        matchedPolicyVersion: abacPass.invalidMatch.dslVersion
      };
    }

    if (abacPass.denyMatch) {
      return {
        allowed: false,
        reason: "Denied by ABAC policy.",
        matchedPolicy: abacPass.denyMatch.policyCode,
        matchedPolicyVersion: abacPass.denyMatch.dslVersion
      };
    }
  }

  const key = permissionKey(
    request.moduleKey,
    request.activityCode,
    request.action
  );

  if (!grantedPermissionKeys.has(key)) {
    return {
      allowed: false,
      reason: "No role permission grants this action.",
      matchedPolicy: "default_deny"
    };
  }

  // Allow-constraint: an allow-policy never grants a permission (the RBAC gate
  // above already passed), but when any allow-policy is applicable it narrows
  // the grant — at least one must be satisfied, else deny.
  if (abacPass && abacPass.allowApplicable) {
    if (abacPass.allowSatisfied) {
      return {
        allowed: true,
        reason: "Granted via role permission and allowed by ABAC policy.",
        matchedPolicy: abacPass.allowSatisfied.policyCode,
        matchedPolicyVersion: abacPass.allowSatisfied.dslVersion
      };
    }
    return {
      allowed: false,
      reason: "No ABAC allow-policy condition is satisfied for this request.",
      matchedPolicy: "abac_allow_unsatisfied"
    };
  }

  return {
    allowed: true,
    reason: "Granted via role permission.",
    matchedPolicy: "role_permission"
  };
}
