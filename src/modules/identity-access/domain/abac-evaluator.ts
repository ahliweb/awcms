/**
 * ABAC evaluator — a PURE interpreter over the condition AST (Issue #179).
 *
 * No I/O, no clock read (the request timestamp is injected), no `eval`/
 * `new Function`/dynamic import/SQL. It walks the bounded AST produced by
 * `abac-policy.ts` against a server-built attribute bag and returns a
 * deterministic verdict. It is consumed by `access-control.ts`'s
 * `evaluateAccess` (which owns the RBAC/ABAC precedence) — this file only
 * answers "which policies match and what do their conditions evaluate to".
 *
 * Fail-closed: an unknown attribute/operator, or a stored policy whose
 * condition failed to compile, raises/records a condition that forces DENY at
 * the call site. Legitimately-absent attribute values (a request that simply
 * did not carry `resource.amount`) are NOT errors — the leaf is false — which
 * is deterministic and documented in ADR-0033.
 */

import type {
  AbacAttributeCategory,
  AbacConditionNode,
  AbacLeafNode,
  AbacOperator,
  AbacPolicyApplicability,
  AbacPolicyEffect
} from "./abac-policy";
import { ABAC_OPERATORS, isKnownAbacAttribute } from "./abac-policy";
import type { AccessRequest, TenantContext } from "./access-control";

/** Raised when a condition references something outside the allow-list at
 * EVALUATION time (should be impossible for a stored, validated policy, but
 * enforced as defense in depth so the call site can fail closed). */
export class AbacEvaluationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AbacEvaluationError";
  }
}

/** Server-derived environment, injected so the evaluator stays pure. */
export type AbacEnvironment = {
  now: Date;
  ipTrusted: boolean;
};

/** A stored policy compiled for evaluation. `condition === null` means the
 * stored jsonb failed to parse — an INVALID policy, which forces DENY for any
 * request in its applicability (fail-closed). */
export type CompiledPolicy = {
  policyCode: string;
  effect: AbacPolicyEffect;
  dslVersion: number;
  priority: number;
  applicability: AbacPolicyApplicability;
  condition: AbacConditionNode | null;
  invalidReason?: string;
};

type ResolvedAttribute = {
  present: boolean;
  category: AbacAttributeCategory;
  value: string | number | boolean | readonly string[] | undefined;
};

const OPERATOR_SET: ReadonlySet<string> = new Set(ABAC_OPERATORS);

function stringOrAbsent(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberOrAbsent(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function booleanOrAbsent(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function stringArrayOrAbsent(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.every((element) => typeof element === "string")
    ? (value as string[])
    : undefined;
}

function resolved(
  category: AbacAttributeCategory,
  value: string | number | boolean | readonly string[] | undefined
): ResolvedAttribute {
  return { present: value !== undefined, category, value };
}

/**
 * Build the bounded attribute bag from the AUTHENTICATED context, the request,
 * and the server-derived environment. `subject.*` come ONLY from `context`
 * (never the request body); `resource.*` from `request.resourceAttributes`
 * (which the endpoint must populate from the verified resource); `env.*` are
 * strictly server-derived. Wrong-typed resource attributes resolve as absent,
 * not as an error.
 */
export function buildAttributeBag(
  context: TenantContext,
  request: AccessRequest,
  env: AbacEnvironment
): Record<string, ResolvedAttribute> {
  const ra = request.resourceAttributes ?? {};

  return {
    "subject.tenantUserId": resolved(
      "string",
      stringOrAbsent(context.tenantUserId)
    ),
    "subject.identityId": resolved(
      "string",
      stringOrAbsent(context.identityId)
    ),
    "subject.roles": resolved(
      "stringArray",
      stringArrayOrAbsent(context.roles) ?? []
    ),
    "subject.defaultOfficeId": resolved(
      "string",
      stringOrAbsent(context.defaultOfficeId)
    ),
    "resource.tenantId": resolved("string", stringOrAbsent(ra.tenantId)),
    "resource.ownerTenantUserId": resolved(
      "string",
      stringOrAbsent(ra.ownerTenantUserId)
    ),
    "resource.businessScopeId": resolved(
      "string",
      stringOrAbsent(ra.businessScopeId)
    ),
    "resource.status": resolved("string", stringOrAbsent(ra.status)),
    "resource.resourceType": resolved(
      "string",
      stringOrAbsent(request.resourceType)
    ),
    "resource.amount": resolved("number", numberOrAbsent(ra.amount)),
    action: resolved("string", stringOrAbsent(request.action)),
    "env.now": resolved("date", env.now.toISOString()),
    "env.dayOfWeek": resolved("number", env.now.getUTCDay()),
    "env.ipTrusted": resolved(
      "boolean",
      booleanOrAbsent(env.ipTrusted) ?? false
    )
  };
}

function lookup(
  bag: Record<string, ResolvedAttribute>,
  attr: string
): ResolvedAttribute {
  // OWN-property membership on BOTH the bag and the allow-list. `bag[attr]`
  // and `attr in ABAC_ATTRIBUTES` walk the prototype chain, so prototype keys
  // (__proto__/constructor/toString/…) would resolve inherited members and
  // skip this fail-closed throw. hasOwnProperty closes that hole.
  const entry = Object.prototype.hasOwnProperty.call(bag, attr)
    ? bag[attr]
    : undefined;
  if (!entry || !isKnownAbacAttribute(attr)) {
    throw new AbacEvaluationError(`Unknown attribute "${attr}".`);
  }
  return entry;
}

/** Compare two scalar values by category for eq/ne. Dates compare by epoch. */
function scalarEquals(
  category: AbacAttributeCategory,
  left: unknown,
  right: unknown
): boolean {
  if (category === "date") {
    const l = Date.parse(String(left));
    const r = Date.parse(String(right));
    return Number.isFinite(l) && Number.isFinite(r) && l === r;
  }
  return left === right;
}

/** Numeric/date ordered comparison. Returns undefined if either side is not
 * comparable (absent/unparseable), so the caller treats it as false. */
function orderedCompare(
  category: AbacAttributeCategory,
  left: unknown,
  right: unknown
): number | undefined {
  let l: number;
  let r: number;
  if (category === "date") {
    l = Date.parse(String(left));
    r = Date.parse(String(right));
  } else {
    l = typeof left === "number" ? left : Number.NaN;
    r = typeof right === "number" ? right : Number.NaN;
  }
  if (!Number.isFinite(l) || !Number.isFinite(r)) {
    return undefined;
  }
  return l < r ? -1 : l > r ? 1 : 0;
}

function evaluateLeaf(
  leaf: AbacLeafNode,
  bag: Record<string, ResolvedAttribute>
): boolean {
  const op = leaf.op as AbacOperator;
  if (!OPERATOR_SET.has(op)) {
    throw new AbacEvaluationError(`Unknown operator "${String(leaf.op)}".`);
  }

  const attr = lookup(bag, leaf.attr);

  if (op === "exists") {
    return attr.present;
  }

  // An absent attribute makes every non-exists comparison false — deterministic
  // and NOT an error (the request simply did not carry this attribute).
  if (!attr.present) {
    return false;
  }

  // Resolve the right-hand side: either another attribute or a literal.
  let rhs: unknown;
  if (leaf.valueAttr !== undefined) {
    const other = lookup(bag, leaf.valueAttr);
    if (!other.present) {
      return false;
    }
    rhs = other.value;
  } else {
    rhs = leaf.value;
  }

  switch (op) {
    case "eq":
      return scalarEquals(attr.category, attr.value, rhs);
    case "ne":
      return !scalarEquals(attr.category, attr.value, rhs);
    case "in":
    case "nin": {
      if (!Array.isArray(rhs)) {
        throw new AbacEvaluationError(
          `Operator "${op}" requires an array value.`
        );
      }
      let member: boolean;
      if (attr.category === "stringArray") {
        const held = attr.value as readonly string[];
        member = held.some((element) => rhs.includes(element));
      } else {
        member = rhs.includes(attr.value);
      }
      return op === "in" ? member : !member;
    }
    case "lt":
    case "lte":
    case "gt":
    case "gte": {
      const cmp = orderedCompare(attr.category, attr.value, rhs);
      if (cmp === undefined) {
        return false;
      }
      if (op === "lt") return cmp < 0;
      if (op === "lte") return cmp <= 0;
      if (op === "gt") return cmp > 0;
      return cmp >= 0;
    }
    default:
      throw new AbacEvaluationError(`Unhandled operator "${String(op)}".`);
  }
}

/** Evaluate a condition AST. Throws `AbacEvaluationError` on any unknown
 * attribute/operator (fail-closed at the call site). */
export function evaluateCondition(
  node: AbacConditionNode,
  bag: Record<string, ResolvedAttribute>
): boolean {
  if ("allOf" in node) {
    return node.allOf.every((child) => evaluateCondition(child, bag));
  }
  if ("anyOf" in node) {
    return node.anyOf.some((child) => evaluateCondition(child, bag));
  }
  if ("not" in node) {
    return !evaluateCondition(node.not, bag);
  }
  return evaluateLeaf(node, bag);
}

/** Whether a policy's applicability filter matches the request. A null field
 * is a wildcard; a non-null field must equal the request's value. */
export function isPolicyApplicable(
  applicability: AbacPolicyApplicability,
  request: AccessRequest
): boolean {
  if (
    applicability.moduleKey !== null &&
    applicability.moduleKey !== request.moduleKey
  ) {
    return false;
  }
  if (
    applicability.activityCode !== null &&
    applicability.activityCode !== request.activityCode
  ) {
    return false;
  }
  if (
    applicability.action !== null &&
    applicability.action !== request.action
  ) {
    return false;
  }
  if (
    applicability.resourceType !== null &&
    applicability.resourceType !== (request.resourceType ?? null)
  ) {
    return false;
  }
  return true;
}

/** The result of one ABAC evaluation pass (before RBAC precedence is applied
 * by the caller). */
export type AbacPass = {
  /** An applicable INVALID policy (fail-closed hard deny), if any. */
  invalidMatch: {
    policyCode: string;
    dslVersion: number;
    reason: string;
  } | null;
  /** The first applicable DENY policy whose condition is satisfied. */
  denyMatch: { policyCode: string; dslVersion: number } | null;
  /** Whether any ALLOW policy is applicable at all (constraint present). */
  allowApplicable: boolean;
  /** The first applicable ALLOW policy whose condition is satisfied. */
  allowSatisfied: { policyCode: string; dslVersion: number } | null;
};

/**
 * Evaluate the tenant's active policies for a request. Pure. Throws
 * `AbacEvaluationError` if evaluating a condition hits an unknown attribute/
 * operator — the caller MUST catch and DENY.
 *
 * Deny-overrides: the scan stops at the first satisfied deny (or first
 * applicable invalid) policy, since that decides the outcome regardless of
 * anything else. Allow policies are scanned to completion (up to a deny) so
 * the caller knows whether an allow-constraint is present and satisfied.
 */
export function evaluateAbacPolicies(
  policies: readonly CompiledPolicy[],
  context: TenantContext,
  request: AccessRequest,
  env: AbacEnvironment
): AbacPass {
  const bag = buildAttributeBag(context, request, env);

  const sorted = [...policies].sort(
    (a, b) =>
      a.priority - b.priority || a.policyCode.localeCompare(b.policyCode)
  );

  const pass: AbacPass = {
    invalidMatch: null,
    denyMatch: null,
    allowApplicable: false,
    allowSatisfied: null
  };

  for (const policy of sorted) {
    if (!isPolicyApplicable(policy.applicability, request)) {
      continue;
    }

    if (policy.condition === null) {
      pass.invalidMatch = {
        policyCode: policy.policyCode,
        dslVersion: policy.dslVersion,
        reason: policy.invalidReason ?? "Policy failed to compile."
      };
      return pass; // fail-closed: an applicable invalid policy denies immediately
    }

    if (policy.effect === "deny") {
      if (evaluateCondition(policy.condition, bag)) {
        pass.denyMatch = {
          policyCode: policy.policyCode,
          dslVersion: policy.dslVersion
        };
        return pass; // deny overrides everything; no need to scan further
      }
      continue;
    }

    // effect === "allow"
    pass.allowApplicable = true;
    if (
      pass.allowSatisfied === null &&
      evaluateCondition(policy.condition, bag)
    ) {
      pass.allowSatisfied = {
        policyCode: policy.policyCode,
        dslVersion: policy.dslVersion
      };
    }
  }

  return pass;
}
