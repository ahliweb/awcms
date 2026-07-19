/**
 * Segregation-of-duties (SoD) conflict detection (Issue #181, epic #177
 * Wave 2 authorization). Ported from awcms-mini
 * (`identity-access/domain/sod-conflict-evaluation.ts`, Issue #746). Pure,
 * I/O-free domain logic — the same "resolve the facts elsewhere, decide here"
 * split `evaluateAccess` (`access-control.ts`) already follows; kept in its
 * own file rather than growing `access-control.ts` further.
 *
 * A conflict is: the subject holds (via an active business-scope assignment's
 * role, OR an ordinary RBAC role grant) another permission that a registered
 * `SoDRuleDescriptor` (`_shared/module-contract.ts`) declares conflicts with
 * the permission currently being granted/requested — evaluated against
 * `scopeApplicability` (`"global_within_tenant"` = anywhere in the tenant is
 * enough; `"same_scope_only"` = only when both permissions apply to the
 * identical `(scopeType, scopeId)`; `"any"` is reserved, unused today, treated
 * the same as `"global_within_tenant"` so a future rule using it never
 * silently fails open).
 *
 * Ambiguous/unresolved is default-deny, per issue #181's security model: a
 * `"same_scope_only"` rule with no `requestedScope` supplied can never
 * positively rule out a conflict, so it is treated as an INDETERMINATE match
 * here (surfaced in the result, NOT silently dropped) — the caller (the real
 * chokepoint, `access-guard.ts`) decides to deny on indeterminate exactly like
 * a confirmed conflict, per the same default-deny principle, rather than this
 * pure function silently deciding "no requestedScope means no conflict".
 *
 * **Hierarchy-aware `same_scope_only` matching (awcms-mini Issue #794).**
 * `same_scope_only` matches a held fact's scope against `requestedScope` by
 * EXACT `(scopeType, scopeId)` equality AND against the ancestor/descendant
 * references the `BusinessScopeHierarchyPort.resolveScope` computed for the
 * requested scope (supplied via `RequestedScope.relatedScopes` by the caller,
 * `business-scope-assignment-service.ts`/`high-risk-sod-guard.ts` — resolved
 * once, no second I/O here). A subject holding `.create` at a parent
 * `organization_unit` therefore cannot be granted `.revoke` at a
 * hierarchically-related child unit without tripping a same-scope rule. A
 * caller that never resolves hierarchy (e.g. the base no-op adapter) simply
 * omits `relatedScopes`, preserving exact-match-only behavior for that case.
 *
 * **Hoisted index (awcms-mini Issue #833).** `detectSoDConflicts` is called
 * ONCE PER PERMISSION the assigned role grants (100-200 for an admin role,
 * `business-scope-assignment-service.ts`), and a naive implementation rescans
 * every rule's key list, then `subjectFacts` in full (many facts for a subject
 * with several assignments), then `relatedScopes` nested inside that —
 * O(P×R×K×F×S), millions of element visits for ONE POST, all inside the DB
 * transaction. `createSoDConflictEvaluator` builds the three indexes ONCE per
 * request (rules by trigger key, facts by permission key, related scopes as a
 * Set) and `detect` then does O(matchingRules) work per permission — the
 * bounded, non-N+1 evaluation issue #181 requires. `detectSoDConflicts` is
 * retained as a thin single-shot wrapper for callers that only ever evaluate
 * one permission key (`high-risk-sod-guard.ts`).
 */
import type { SoDRuleDescriptor } from "../../_shared/module-contract";

/**
 * One permission a subject currently holds — resolved ahead of time (I/O)
 * by `business-scope-facts.ts`'s `resolveSoDAssignmentFacts`, never here.
 * Two sources are merged into this same fact shape:
 *
 * - Held via an ACTIVE `awcms_business_scope_assignments` row's role —
 *   `scopeType`/`scopeId` are that assignment's own scope (a
 *   `"same_scope_only"` rule only conflicts when the OTHER held permission is
 *   at the IDENTICAL scope).
 * - Held via an ordinary `awcms_access_assignments` role grant (the path every
 *   other authorization check in this codebase reads from) —
 *   `scopeType`/`scopeId` are both `null`, since an ordinary role grant is not
 *   confined to any business scope at all. `detectSoDConflicts` below treats a
 *   `null`-scope fact as matching ANY requested scope for a
 *   `"same_scope_only"` rule (an unscoped grant is, definitionally, held "at"
 *   every scope) — the same "blanket covers every scope" reasoning
 *   `isSoDConflictExceptionCurrentlyValid` documents for a blanket exception.
 */
export type SoDAssignmentFact = {
  permissionKey: string;
  scopeType: string | null;
  scopeId: string | null;
};

export type RequestedScope = {
  scopeType: string;
  scopeId: string;
  /**
   * Other scope references considered part of the SAME business hierarchy as
   * `(scopeType, scopeId)` for a `"same_scope_only"` rule's purposes —
   * typically the requested scope's own `ancestorScopes`/`descendantScopes`
   * from `BusinessScopeHierarchyPort.resolveScope` (awcms-mini Issue #794).
   * Optional and empty by default: a caller that resolves scope through a flat
   * adapter (no real hierarchy) omits this entirely, which is exactly
   * equivalent to passing `[]` — exact `(scopeType, scopeId)` equality is
   * still the only match for that case.
   */
  relatedScopes?: readonly { scopeType: string; scopeId: string }[];
};

export type SoDConflictMatch = {
  rule: SoDRuleDescriptor;
  /** The OTHER conflicting permission key the subject was found to already hold (or, for an indeterminate same-scope match, the one that COULD conflict pending scope resolution). */
  conflictingPermissionKey: string;
  /** `true` when scope resolution was required but not supplied — the caller must default-deny, not treat this as "no conflict". */
  indeterminate: boolean;
};

/**
 * A rule that `requestedPermissionKey` triggers, with the rule's OTHER
 * conflicting keys precomputed at index-build time.
 */
type IndexedRule = {
  rule: SoDRuleDescriptor;
  otherKeys: readonly string[];
};

/**
 * `scopeType`/`scopeId` are both DB-controlled identifiers (a registered scope
 * type name and a uuid), never free-form user input, but a NUL separator is
 * used anyway so no pair of legal values can ever collide into the same
 * composite key.
 */
const SCOPE_KEY_SEPARATOR = "\u0000";

function scopeKey(scopeType: string, scopeId: string): string {
  return `${scopeType}${SCOPE_KEY_SEPARATOR}${scopeId}`;
}

/**
 * Evaluates SoD conflicts for MANY requested permission keys against ONE fixed
 * `(rules, requestedScope, subjectFacts)` context, without rescanning any of
 * them per key. See this file's header for why.
 */
export type SoDConflictEvaluator = {
  detect(requestedPermissionKey: string): SoDConflictMatch[];
};

/**
 * Builds the per-request indexes ONCE — O(R×K + F + S) — and returns an
 * evaluator whose `detect` is O(matchingRules) per permission key.
 *
 * Callers evaluating a role's whole permission set
 * (`business-scope-assignment-service.ts`) MUST build this once outside their
 * loop; a caller evaluating exactly one key can keep using
 * `detectSoDConflicts`.
 */
export function createSoDConflictEvaluator(
  rules: readonly SoDRuleDescriptor[],
  requestedScope: RequestedScope | null,
  subjectFacts: readonly SoDAssignmentFact[]
): SoDConflictEvaluator {
  // Rules keyed by each permission key that TRIGGERS them, preserving the
  // registry's own array order within each bucket — `detect` emits matches in
  // the same order the caller records audit rows in.
  const rulesByTriggerKey = new Map<string, IndexedRule[]>();
  for (const rule of rules) {
    const conflictingKeys = rule.conflictingPermissionKeys;
    const registeredTriggers = new Set<string>();
    for (const triggerKey of conflictingKeys) {
      // A key listed twice is dedup'd on the TRIGGER side so it still produces
      // exactly one rule visit.
      if (registeredTriggers.has(triggerKey)) {
        continue;
      }
      registeredTriggers.add(triggerKey);

      const indexed: IndexedRule = {
        rule,
        otherKeys: conflictingKeys.filter((key) => key !== triggerKey)
      };
      const bucket = rulesByTriggerKey.get(triggerKey);
      if (bucket) {
        bucket.push(indexed);
      } else {
        rulesByTriggerKey.set(triggerKey, [indexed]);
      }
    }
  }

  // Facts bucketed by permission key, replacing a full `subjectFacts` rescan
  // per rule per key. Insertion order within a bucket is `subjectFacts` order.
  const factsByPermissionKey = new Map<string, SoDAssignmentFact[]>();
  for (const fact of subjectFacts) {
    const bucket = factsByPermissionKey.get(fact.permissionKey);
    if (bucket) {
      bucket.push(fact);
    } else {
      factsByPermissionKey.set(fact.permissionKey, [fact]);
    }
  }

  // `relatedScopes` as a Set, replacing a nested `relatedScopes.some(...)`.
  const relatedScopeKeys = new Set<string>();
  for (const related of requestedScope?.relatedScopes ?? []) {
    relatedScopeKeys.add(scopeKey(related.scopeType, related.scopeId));
  }

  function factMatchesRequestedScope(fact: SoDAssignmentFact): boolean {
    // A `null`-scope fact (ordinary RBAC role grant — not confined to any
    // business scope) conflicts at EVERY requested scope.
    if (fact.scopeType === null && fact.scopeId === null) {
      return true;
    }
    if (!requestedScope) {
      return false;
    }
    if (
      fact.scopeType === requestedScope.scopeType &&
      fact.scopeId === requestedScope.scopeId
    ) {
      return true;
    }
    // Hierarchy-aware match (awcms-mini Issue #794): a fact held at a scope the
    // caller has already resolved as an ancestor/descendant of the requested
    // scope is the SAME business hierarchy this rule is meant to bound. A
    // half-null fact scope can never equal a `relatedScopes` entry (both of
    // whose fields are non-null strings).
    if (fact.scopeType === null || fact.scopeId === null) {
      return false;
    }
    return relatedScopeKeys.has(scopeKey(fact.scopeType, fact.scopeId));
  }

  return {
    detect(requestedPermissionKey: string): SoDConflictMatch[] {
      const matches: SoDConflictMatch[] = [];
      const candidates = rulesByTriggerKey.get(requestedPermissionKey);
      if (!candidates) {
        return matches;
      }

      for (const { rule, otherKeys } of candidates) {
        for (const otherKey of otherKeys) {
          const holdingFacts = factsByPermissionKey.get(otherKey);
          if (!holdingFacts || holdingFacts.length === 0) {
            continue;
          }

          if (rule.scopeApplicability === "same_scope_only") {
            if (!requestedScope) {
              matches.push({
                rule,
                conflictingPermissionKey: otherKey,
                indeterminate: true
              });
              continue;
            }

            if (holdingFacts.some(factMatchesRequestedScope)) {
              matches.push({
                rule,
                conflictingPermissionKey: otherKey,
                indeterminate: false
              });
            }
            continue;
          }

          // "global_within_tenant" (and the reserved, currently-unused "any")
          // — holding the other permission ANYWHERE in the tenant is itself
          // the conflict, no scope match required.
          matches.push({
            rule,
            conflictingPermissionKey: otherKey,
            indeterminate: false
          });
        }
      }

      return matches;
    }
  };
}

/**
 * Every rule (from the WHOLE registry, `collectSoDRuleDescriptors`) whose
 * `conflictingPermissionKeys` includes `requestedPermissionKey` AND whose
 * OTHER conflicting key(s) the subject is already found to hold (per
 * `scopeApplicability`), based on `subjectFacts` (that subject's OTHER
 * currently-active granted permissions — EXCLUDING the assignment/action being
 * evaluated itself, the caller's responsibility to exclude before calling
 * this).
 *
 * Single-shot convenience over `createSoDConflictEvaluator` — builds the
 * index, evaluates one key, discards it. Correct for a caller with exactly one
 * permission key to check; a caller looping over a role's permission set must
 * hoist the evaluator itself instead of calling this per key.
 */
export function detectSoDConflicts(
  rules: readonly SoDRuleDescriptor[],
  requestedPermissionKey: string,
  requestedScope: RequestedScope | null,
  subjectFacts: readonly SoDAssignmentFact[]
): SoDConflictMatch[] {
  return createSoDConflictEvaluator(rules, requestedScope, subjectFacts).detect(
    requestedPermissionKey
  );
}

/**
 * Whether a SoD conflict exception ROW currently authorizes bypassing a
 * conflict, checked against `now` rather than trusted from `status` alone —
 * "status is a cache, effective_to compared against now() is the real gate"
 * (the same convention `isBusinessScopeAssignmentCurrentlyActive` uses). A
 * `status: "approved"` row whose `effectiveTo` has already passed is NOT
 * currently valid, even though nothing has (yet) run the expiry job to flip
 * its `status` to `"expired"` (issue #181: "Exception expired/revoked langsung
 * tidak berlaku").
 */
export function isSoDConflictExceptionCurrentlyValid(
  exception: {
    status: string;
    effectiveFrom: Date;
    effectiveTo: Date;
    scopeType: string | null;
    scopeId: string | null;
  },
  now: Date,
  requestedScope: RequestedScope | null
): boolean {
  if (exception.status !== "approved") {
    return false;
  }
  if (now < exception.effectiveFrom || now >= exception.effectiveTo) {
    return false;
  }
  // A scope-specific exception only covers ITS OWN scope; a blanket exception
  // (scopeType/scopeId both null at creation) covers every scope, including an
  // indeterminate (no requestedScope) high-risk decision — a blanket exception
  // is an explicit, human-approved, bounded-lifetime grant.
  if (exception.scopeType === null && exception.scopeId === null) {
    return true;
  }
  if (!requestedScope) {
    return false;
  }
  return (
    exception.scopeType === requestedScope.scopeType &&
    exception.scopeId === requestedScope.scopeId
  );
}

const MAX_TEXT_FIELD_LENGTH = 2000;
const MIN_JUSTIFICATION_LENGTH = 10;

export type SoDConflictExceptionValidationError = {
  field: string;
  message: string;
};

export type CreateSoDConflictExceptionInput = {
  ruleKey: string;
  scopeType: string | null;
  scopeId: string | null;
  justification: string;
  effectiveFrom: Date;
  effectiveTo: Date;
};

/**
 * Structural validation only — NOT the "rule actually exists in the
 * registry"/"exceptionPolicy.allowed"/"maxDurationDays bound" checks (those
 * need the SoD rule registry, applied by
 * `application/sod-exception-service.ts`, which has it in scope).
 */
export function validateCreateSoDConflictExceptionInput(
  input: CreateSoDConflictExceptionInput
): SoDConflictExceptionValidationError[] {
  const errors: SoDConflictExceptionValidationError[] = [];

  if (!input.ruleKey) {
    errors.push({ field: "ruleKey", message: "ruleKey is required." });
  }

  if ((input.scopeType === null) !== (input.scopeId === null)) {
    errors.push({
      field: "scopeType",
      message:
        "scopeType and scopeId must both be set (scope-specific exception) or both be null (blanket exception)."
    });
  }

  if (
    !input.justification ||
    input.justification.trim().length < MIN_JUSTIFICATION_LENGTH
  ) {
    errors.push({
      field: "justification",
      message: `justification is required and must be at least ${MIN_JUSTIFICATION_LENGTH} characters.`
    });
  } else if (input.justification.length > MAX_TEXT_FIELD_LENGTH) {
    errors.push({
      field: "justification",
      message: `justification must be at most ${MAX_TEXT_FIELD_LENGTH} characters.`
    });
  }

  if (Number.isNaN(input.effectiveFrom.getTime())) {
    errors.push({
      field: "effectiveFrom",
      message: "effectiveFrom must be a valid date."
    });
  }

  if (Number.isNaN(input.effectiveTo.getTime())) {
    errors.push({
      field: "effectiveTo",
      message: "effectiveTo must be a valid date."
    });
  } else if (input.effectiveTo <= input.effectiveFrom) {
    errors.push({
      field: "effectiveTo",
      message:
        "effectiveTo must be after effectiveFrom — exceptions must have a bounded lifetime (no indefinite override)."
    });
  }

  return errors;
}

export type DecideSoDConflictExceptionInput = {
  decisionReason: string | null;
};

export type RevokeSoDConflictExceptionInput = {
  revokeReason: string;
};

export function validateRevokeSoDConflictExceptionInput(
  input: RevokeSoDConflictExceptionInput
): SoDConflictExceptionValidationError[] {
  const errors: SoDConflictExceptionValidationError[] = [];

  if (!input.revokeReason || input.revokeReason.trim().length === 0) {
    errors.push({
      field: "revokeReason",
      message: "revokeReason is required."
    });
  } else if (input.revokeReason.length > MAX_TEXT_FIELD_LENGTH) {
    errors.push({
      field: "revokeReason",
      message: `revokeReason must be at most ${MAX_TEXT_FIELD_LENGTH} characters.`
    });
  }

  return errors;
}
