/**
 * SoD conflict enforcement at the real `authorizeInTransaction` chokepoint
 * (Issue #181, epic #177 Wave 2 authorization). Ported from awcms-mini
 * (`identity-access/application/high-risk-sod-guard.ts`, Issue #746). Called
 * from `access-guard.ts`'s `authorizeInTransaction` for every
 * `isHighRiskAction` decision, satisfying the acceptance criterion "High-risk
 * action memeriksa conflict pada saat eksekusi, bukan hanya saat assignment"
 * against a real, widely-shared production entrypoint — this is ACTION-TIME
 * enforcement (fail-closed on a detected, un-excepted conflict), distinct from
 * the ASSIGNMENT-TIME evaluation `business-scope-assignment-service.ts` runs.
 *
 * **Base ships exactly one governance rule.** `SOD_RULES` is composed from
 * `listModules()`. The base ships no *domain business* rule (issue #181
 * out-of-scope; those stay in the in-repo fixture), but since ADR-0037 the
 * `data_lifecycle` System-Foundation module ships one module-owned governance
 * rule — `data_lifecycle.legal_hold_maker_checker` (maker/checker over its own
 * `legal_hold.create`/`.release`). So in a pure-base deployment this guard is
 * NOT inert: `SOD_RELEVANT_PERMISSION_KEYS` contains those two keys and a
 * request touching either resolves the subject's facts and can be denied. Any
 * further domain module added directly to `src/modules/` with `sodRules` adds
 * more. The optional `rules` parameter lets a test/composition root inject a
 * rule set (e.g. the in-repo fixture's illustrative rules) to exercise
 * enforcement without editing any base module — production always uses the
 * default `SOD_RULES`.
 *
 * **Both fact sources.** The subject can hold a conflicting permission via an
 * active business-scope assignment's role OR an ordinary RBAC role grant;
 * `resolveSoDAssignmentFacts` merges both (see `business-scope-facts.ts`). The
 * ordinary-RBAC path is the realistic case (a role granting both halves of a
 * conflict) this guard must not be blind to.
 *
 * **Deny-overrides-allow.** Called immediately AFTER an ordinary ABAC decision
 * has ALREADY allowed a high-risk action — this function can only additionally
 * DENY (never upgrades a deny to an allow), consistent with `evaluateAccess`'s
 * own default-deny chain. Every deny/exception outcome is written to the
 * append-only `awcms_sod_conflict_evaluations` decision log.
 *
 * **Bounded cost.** The `SOD_RELEVANT_PERMISSION_KEYS` membership check
 * short-circuits BEFORE any query for the ~99% of requests whose permission
 * key appears in no registered rule — extending this shared chokepoint costs
 * nothing measurable for endpoints this feature does not touch. When it does
 * fire, exactly two SELECTs resolve the subject's facts (bounded, non-N+1).
 */
import { listModules } from "../../index";
import { recordCounter } from "../../../lib/observability/metrics-port";
import type { SoDRuleDescriptor } from "../../_shared/module-contract";
import type { BusinessScopeHierarchyPort } from "../../_shared/ports/business-scope-hierarchy-port";
import type { AccessRequest, TenantContext } from "../domain/access-control";
import { permissionKey } from "../domain/access-control";
import {
  detectSoDConflicts,
  type RequestedScope
} from "../domain/sod-conflict-evaluation";
import { collectSoDRuleDescriptors } from "../domain/sod-rule-registry";
import { resolveSoDAssignmentFacts } from "./business-scope-facts";
import { recordSoDConflictEvaluation } from "./sod-conflict-evaluation-log";
import { findValidSoDConflictException } from "./sod-exception-service";

/** The module registry's SoD rules. A pure base ships exactly one — the `data_lifecycle` legal-hold maker/checker (ADR-0037); domain business rules stay fixture-only (#181). */
const SOD_RULES = collectSoDRuleDescriptors(listModules());

/** Every permission key appearing in ANY default-registry rule — the cheap short-circuit set. Precomputed once for the common (default `SOD_RULES`) path. */
const DEFAULT_SOD_RELEVANT_PERMISSION_KEYS = new Set(
  SOD_RULES.flatMap((rule) => rule.conflictingPermissionKeys)
);

function relevantKeysFor(
  rules: readonly SoDRuleDescriptor[]
): ReadonlySet<string> {
  return rules === SOD_RULES
    ? DEFAULT_SOD_RELEVANT_PERMISSION_KEYS
    : new Set(rules.flatMap((rule) => rule.conflictingPermissionKeys));
}

export type HighRiskSoDCheckResult =
  { blocked: false } | { blocked: true; reason: string };

export type HighRiskSoDCheckOptions = {
  hierarchyPort?: BusinessScopeHierarchyPort;
  /**
   * The SoD rule set to enforce. Defaults to the composed registry
   * (`SOD_RULES`), which is what production always uses. A test/composition
   * root may inject a rule set to exercise enforcement in a pure-base build
   * whose registry declares no rules.
   */
  rules?: readonly SoDRuleDescriptor[];
};

/**
 * Deliberately a DIFFERENT `resourceAttributes` key pair
 * (`sodScopeType`/`sodScopeId`) than `evaluateAccess`'s own
 * `requiredScopeType`/`requiredScopeId` — the two mechanisms answer different
 * questions and must not be conflated: the ordinary ABAC pair asks "does the
 * ACTOR possess a resolved business-scope fact for X" (a gate on the actor's
 * OWN facts), while this pair only tells the SoD conflict check WHICH scope the
 * SUBJECT's conflicting permission (if any) should be matched against for a
 * `"same_scope_only"` rule — the actor and subject are frequently different
 * people (e.g. an administrator revoking someone else's assignment).
 */
function extractRequestedScope(guard: AccessRequest): RequestedScope | null {
  const scopeType = guard.resourceAttributes?.sodScopeType;
  const scopeId = guard.resourceAttributes?.sodScopeId;

  if (typeof scopeType === "string" && typeof scopeId === "string") {
    return { scopeType, scopeId };
  }
  return null;
}

/**
 * Called by `access-guard.ts`'s `authorizeInTransaction` immediately after an
 * ordinary ABAC decision has ALREADY allowed a high-risk action — this
 * function can only additionally DENY (deny-overrides-allow), consistent with
 * `evaluateAccess`'s own default-deny chain.
 *
 * `options.hierarchyPort` is OPTIONAL and looked up LAZILY — only queried when
 * both (a) `requestedScope` was actually supplied AND (b) the cheap
 * `SOD_RELEVANT_PERMISSION_KEYS` short-circuit already passed — so every other
 * caller pays zero extra cost and sees zero behavior change.
 */
export async function checkHighRiskSoDConflicts(
  tx: Bun.SQL,
  tenantId: string,
  context: TenantContext,
  guard: AccessRequest,
  now: Date,
  options?: HighRiskSoDCheckOptions
): Promise<HighRiskSoDCheckResult> {
  const rules = options?.rules ?? SOD_RULES;
  const relevantKeys = relevantKeysFor(rules);

  const requestedPermissionKey = permissionKey(
    guard.moduleKey,
    guard.activityCode,
    guard.action
  );

  if (!relevantKeys.has(requestedPermissionKey)) {
    return { blocked: false };
  }

  const extractedScope = extractRequestedScope(guard);
  // Hierarchy-aware `same_scope_only` matching: reuse the same
  // `RequestedScope.relatedScopes` mechanism the assignment-create path uses.
  // `resolution.resolved === false` (unknown scope, deleted scope, wrong
  // tenant, or no `hierarchyPort` supplied) leaves `requestedScope` as
  // exact-match-only — never a crash, never a wider grant (fail-closed).
  let requestedScope = extractedScope;
  if (extractedScope && options?.hierarchyPort) {
    const resolution = await options.hierarchyPort.resolveScope(
      tx,
      tenantId,
      extractedScope.scopeType,
      extractedScope.scopeId
    );
    if (resolution.resolved) {
      requestedScope = {
        ...extractedScope,
        relatedScopes: [
          ...resolution.ancestorScopes,
          ...resolution.descendantScopes
        ]
      };
    }
  }

  const subjectFacts = await resolveSoDAssignmentFacts(
    tx,
    tenantId,
    context.tenantUserId,
    now,
    null
  );
  const matches = detectSoDConflicts(
    rules,
    requestedPermissionKey,
    requestedScope,
    subjectFacts
  );

  if (matches.length === 0) {
    return { blocked: false };
  }

  let blocked = false;
  let blockReason = "";

  for (const match of matches) {
    const exception = match.indeterminate
      ? null
      : await findValidSoDConflictException(
          tx,
          tenantId,
          match.rule.ruleKey,
          context.tenantUserId,
          now,
          requestedScope
        );

    const resolvedVia = match.indeterminate
      ? "denied"
      : exception
        ? "exception"
        : "denied";

    const decisionReason = match.indeterminate
      ? `Conflict with "${match.conflictingPermissionKey}" could not be scope-resolved for a same-scope-only rule — default-deny.`
      : exception
        ? `Conflict with "${match.conflictingPermissionKey}" covered by an approved exception.`
        : `Conflict with "${match.conflictingPermissionKey}" — no approved exception on file.`;

    await recordSoDConflictEvaluation(tx, tenantId, {
      ruleKey: match.rule.ruleKey,
      subjectTenantUserId: context.tenantUserId,
      triggerContext: "high_risk_decision",
      conflictDetected: true,
      resolvedVia,
      decisionReason,
      metadata: { requestedPermissionKey }
    });

    recordCounter("sod_conflicts_detected_total", {
      ruleKey: match.rule.ruleKey,
      resolvedVia
    });

    if (resolvedVia === "denied") {
      blocked = true;
      blockReason = `Segregation-of-duties conflict (rule "${match.rule.ruleKey}"): ${decisionReason}`;
    }
  }

  return blocked ? { blocked: true, reason: blockReason } : { blocked: false };
}
