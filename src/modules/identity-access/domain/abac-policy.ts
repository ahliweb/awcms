/**
 * ABAC policy DSL — types, parser, and fail-closed validator (Issue #179).
 *
 * A stored policy carries a bounded, deterministic, versioned condition AST in
 * its `conditions` jsonb column. This file defines that grammar and the ONLY
 * way to turn untrusted jsonb into a trusted, evaluable AST. It is a PURE
 * interpreter's front end: there is no `eval`, no `new Function`, no dynamic
 * import, no templated SQL, and no arbitrary expression — a condition is a
 * tree of a fixed, small set of node kinds over a fixed, server-resolved
 * attribute allow-list and a fixed operator set.
 *
 * Fail-closed everywhere: an unknown attribute, unknown operator, wrong value
 * type, wrong operand arity, an unknown DSL version, or any structural defect
 * makes the policy INVALID at authoring time (rejected by the CRUD endpoint)
 * and — as defense in depth — makes it DENY at evaluation time if it somehow
 * reaches the evaluator (see `abac-evaluator.ts`).
 *
 * The evaluator's precedence model (deny-overrides + allow-as-constraint,
 * RBAC still required) is documented in ADR-0033; this file is only the
 * grammar + validation half.
 */

/** Current DSL grammar version. A stored policy with a higher `dslVersion`
 * than this is rejected (a future grammar this build does not understand);
 * with a lower version is accepted only while every lower version remains a
 * strict subset of this one (it is, for v1 — the only version so far). */
export const ABAC_DSL_VERSION = 1;

/** The bounded operator set. NO regex, NO functions, NO arbitrary expressions. */
export const ABAC_OPERATORS = [
  "eq",
  "ne",
  "in",
  "nin",
  "lt",
  "lte",
  "gt",
  "gte",
  "exists"
] as const;

export type AbacOperator = (typeof ABAC_OPERATORS)[number];

/** Value categories an attribute resolves to. `lt/lte/gt/gte` are legal ONLY
 * on `number`/`date` attributes; `eq/ne` on scalar (string/number/boolean/
 * date); `in/nin` treat `stringArray` as set-membership/overlap. */
export type AbacAttributeCategory =
  "string" | "number" | "boolean" | "date" | "stringArray";

/** One entry in the server-side attribute allow-list. `source` documents where
 * the value comes from — subject attributes are ALWAYS taken from the
 * authenticated context, NEVER from a client request body. Resource attributes
 * come from `request.resourceAttributes`, which the calling endpoint is
 * required to populate from the persisted/verified resource (ownership must be
 * checked against the real row, never a client-claimed owner). Env attributes
 * are strictly server-derived. */
export type AbacAttributeSpec = {
  category: AbacAttributeCategory;
  source: "subject" | "resource" | "action" | "env";
  description: string;
};

/**
 * THE BOUNDED ATTRIBUTE ALLOW-LIST. An `attr`/`valueAttr` string not present
 * here is an unknown attribute: invalid at authoring, deny at evaluation.
 * Keys are namespaced (`subject.*`, `resource.*`, `action`, `env.*`).
 */
export const ABAC_ATTRIBUTES: Readonly<Record<string, AbacAttributeSpec>> = {
  // subject.* — from the authenticated TenantContext, never the request body.
  "subject.tenantUserId": {
    category: "string",
    source: "subject",
    description: "Authenticated acting tenant user id."
  },
  "subject.identityId": {
    category: "string",
    source: "subject",
    description: "Authenticated identity id."
  },
  "subject.roles": {
    category: "stringArray",
    source: "subject",
    description: "Role codes granted to the acting subject."
  },
  "subject.defaultOfficeId": {
    category: "string",
    source: "subject",
    description: "Acting subject's default office id (may be absent)."
  },
  // resource.* — from request.resourceAttributes, server-populated from the
  // real resource by the calling endpoint (see file header + ADR-0033).
  "resource.tenantId": {
    category: "string",
    source: "resource",
    description: "Owning tenant id of the target resource."
  },
  "resource.ownerTenantUserId": {
    category: "string",
    source: "resource",
    description: "Tenant user id that owns the target resource."
  },
  "resource.businessScopeId": {
    category: "string",
    source: "resource",
    description: "Business scope id the resource belongs to."
  },
  "resource.status": {
    category: "string",
    source: "resource",
    description: "Lifecycle/status of the target resource."
  },
  "resource.resourceType": {
    category: "string",
    source: "resource",
    description: "Type of the target resource (request.resourceType)."
  },
  "resource.amount": {
    category: "number",
    source: "resource",
    description: "Monetary/quantitative amount on the target resource."
  },
  // action — the request action string.
  action: {
    category: "string",
    source: "action",
    description: "The requested action."
  },
  // env.* — strictly server-derived, never client-supplied.
  "env.now": {
    category: "date",
    source: "env",
    description: "Server request timestamp (ISO 8601)."
  },
  "env.dayOfWeek": {
    category: "number",
    source: "env",
    description: "Server-derived UTC day of week (0=Sunday..6=Saturday)."
  },
  "env.ipTrusted": {
    category: "boolean",
    source: "env",
    description: "Whether the request originates from a trusted network."
  }
};

/**
 * OWN-PROPERTY membership against the allow-list. Bracket access / the `in`
 * operator walk the prototype chain, so prototype-chain keys (`__proto__`,
 * `constructor`, `toString`, `hasOwnProperty`, `valueOf`, …) would otherwise
 * resolve an inherited member and slip past the unknown-attribute check —
 * defeating the fail-closed "unknown attribute -> deny/invalid" contract in
 * BOTH the authoring validator and the eval-time backstop. Gate every
 * allow-list lookup through this helper. Returns the spec (never an inherited
 * one) or undefined for anything not authored on the object itself.
 */
export function lookupAbacAttribute(
  attr: string
): AbacAttributeSpec | undefined {
  return Object.prototype.hasOwnProperty.call(ABAC_ATTRIBUTES, attr)
    ? ABAC_ATTRIBUTES[attr]
    : undefined;
}

/** True only when `attr` is an OWN key of the allow-list (no prototype keys). */
export function isKnownAbacAttribute(attr: string): boolean {
  return Object.prototype.hasOwnProperty.call(ABAC_ATTRIBUTES, attr);
}

export type AbacLeafNode = {
  attr: string;
  op: AbacOperator;
  value?: unknown;
  valueAttr?: string;
};

export type AbacAllOfNode = { allOf: AbacConditionNode[] };
export type AbacAnyOfNode = { anyOf: AbacConditionNode[] };
export type AbacNotNode = { not: AbacConditionNode };

export type AbacConditionNode =
  AbacAllOfNode | AbacAnyOfNode | AbacNotNode | AbacLeafNode;

export type AbacPolicyEffect = "allow" | "deny";

/** Applicability filter — each field nullable = wildcard. */
export type AbacPolicyApplicability = {
  moduleKey: string | null;
  activityCode: string | null;
  action: string | null;
  resourceType: string | null;
};

export type AbacParseSuccess = {
  valid: true;
  node: AbacConditionNode;
};

export type AbacParseFailure = {
  valid: false;
  errors: string[];
};

export type AbacParseResult = AbacParseSuccess | AbacParseFailure;

const OPERATOR_SET: ReadonlySet<string> = new Set(ABAC_OPERATORS);

/** Operators whose operand must be numeric or date. */
const COMPARISON_OPERATORS: ReadonlySet<AbacOperator> = new Set([
  "lt",
  "lte",
  "gt",
  "gte"
]);

/** Max AST depth — a hard bound so a pathological deeply-nested condition can
 * never blow the stack. 32 is far beyond any real policy. */
const MAX_DEPTH = 32;

/** Max total nodes in one condition tree — a second, independent bound. */
const MAX_NODES = 512;

const ISO_DATE_PATTERN =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoDateString(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) {
    return false;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

/** Whether a literal `value` is compatible with an attribute category, for a
 * scalar operator (`eq`/`ne`). */
function scalarValueMatchesCategory(
  value: unknown,
  category: AbacAttributeCategory
): boolean {
  switch (category) {
    case "string":
    case "stringArray":
      // eq/ne compares a stringArray attr element-wise is disallowed elsewhere;
      // for a `string` attr the literal must be a string.
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "date":
      return isIsoDateString(value);
    default:
      return false;
  }
}

type LeafValidationContext = {
  path: string;
  errors: string[];
};

function validateLeaf(leaf: AbacLeafNode, ctx: LeafValidationContext): void {
  const spec = lookupAbacAttribute(leaf.attr);

  if (!spec) {
    ctx.errors.push(`${ctx.path}: unknown attribute "${leaf.attr}".`);
    return;
  }

  if (!OPERATOR_SET.has(leaf.op)) {
    ctx.errors.push(`${ctx.path}: unknown operator "${String(leaf.op)}".`);
    return;
  }

  const hasValue = Object.prototype.hasOwnProperty.call(leaf, "value");
  const hasValueAttr =
    Object.prototype.hasOwnProperty.call(leaf, "valueAttr") &&
    leaf.valueAttr !== undefined;

  // `exists` takes NEITHER operand.
  if (leaf.op === "exists") {
    if (hasValue || hasValueAttr) {
      ctx.errors.push(
        `${ctx.path}: operator "exists" must not carry value/valueAttr.`
      );
    }
    return;
  }

  // Every other operator takes EXACTLY one of value / valueAttr.
  if (hasValue === hasValueAttr) {
    ctx.errors.push(
      `${ctx.path}: operator "${leaf.op}" requires exactly one of value or valueAttr.`
    );
    return;
  }

  // Category/operator compatibility.
  if (COMPARISON_OPERATORS.has(leaf.op)) {
    if (spec.category !== "number" && spec.category !== "date") {
      ctx.errors.push(
        `${ctx.path}: operator "${leaf.op}" is only valid on numeric or date attributes (attr "${leaf.attr}" is ${spec.category}).`
      );
      return;
    }
  }

  if (
    (leaf.op === "eq" || leaf.op === "ne") &&
    spec.category === "stringArray"
  ) {
    ctx.errors.push(
      `${ctx.path}: operator "${leaf.op}" is not valid on the array attribute "${leaf.attr}" — use in/nin.`
    );
    return;
  }

  if (hasValueAttr) {
    const otherSpec = lookupAbacAttribute(leaf.valueAttr as string);
    if (!otherSpec) {
      ctx.errors.push(
        `${ctx.path}: unknown valueAttr "${String(leaf.valueAttr)}".`
      );
      return;
    }
    // in/nin do not support valueAttr (membership needs a literal set).
    if (leaf.op === "in" || leaf.op === "nin") {
      ctx.errors.push(
        `${ctx.path}: operator "${leaf.op}" requires a literal array value, not valueAttr.`
      );
      return;
    }
    // Both sides must share a comparable category.
    if (spec.category !== otherSpec.category) {
      ctx.errors.push(
        `${ctx.path}: valueAttr "${leaf.valueAttr}" (${otherSpec.category}) is not comparable with attr "${leaf.attr}" (${spec.category}).`
      );
    }
    return;
  }

  // Literal value branch.
  const value = leaf.value;

  if (leaf.op === "in" || leaf.op === "nin") {
    if (!Array.isArray(value) || value.length === 0) {
      ctx.errors.push(
        `${ctx.path}: operator "${leaf.op}" requires a non-empty array value.`
      );
      return;
    }
    const elementCategory: AbacAttributeCategory =
      spec.category === "stringArray" ? "string" : spec.category;
    for (const element of value) {
      if (!scalarValueMatchesCategory(element, elementCategory)) {
        ctx.errors.push(
          `${ctx.path}: array value element is not a valid ${elementCategory} for attr "${leaf.attr}".`
        );
        return;
      }
    }
    return;
  }

  // eq/ne/lt/lte/gt/gte with a literal.
  if (!scalarValueMatchesCategory(value, spec.category)) {
    ctx.errors.push(
      `${ctx.path}: value is not a valid ${spec.category} for attr "${leaf.attr}".`
    );
  }
}

type NodeValidationState = {
  errors: string[];
  nodeCount: number;
};

function validateNode(
  raw: unknown,
  path: string,
  depth: number,
  state: NodeValidationState
): void {
  state.nodeCount += 1;

  if (depth > MAX_DEPTH) {
    state.errors.push(
      `${path}: condition nesting exceeds max depth ${MAX_DEPTH}.`
    );
    return;
  }
  if (state.nodeCount > MAX_NODES) {
    state.errors.push(`condition tree exceeds max node count ${MAX_NODES}.`);
    return;
  }

  if (!isPlainObject(raw)) {
    state.errors.push(`${path}: node must be a JSON object.`);
    return;
  }

  const keys = Object.keys(raw);

  // Composition nodes: exactly one of allOf/anyOf/not, no extra keys.
  if (
    keys.includes("allOf") ||
    keys.includes("anyOf") ||
    keys.includes("not")
  ) {
    if (keys.length !== 1) {
      state.errors.push(
        `${path}: composition node must have exactly one key (allOf | anyOf | not).`
      );
      return;
    }

    if (keys[0] === "not") {
      validateNode((raw as AbacNotNode).not, `${path}.not`, depth + 1, state);
      return;
    }

    const key = keys[0] as "allOf" | "anyOf";
    const children = (raw as Record<string, unknown>)[key];
    if (!Array.isArray(children)) {
      state.errors.push(`${path}.${key}: must be an array of nodes.`);
      return;
    }
    // Empty allOf = vacuously true; empty anyOf = vacuously false. Both are
    // allowed and deterministic (the default backfill is `{"allOf":[]}`).
    children.forEach((child, index) => {
      validateNode(child, `${path}.${key}[${index}]`, depth + 1, state);
    });
    return;
  }

  // Otherwise it must be a leaf.
  if (!keys.includes("attr") || !keys.includes("op")) {
    state.errors.push(
      `${path}: node must be a composition (allOf/anyOf/not) or a leaf ({attr, op, ...}).`
    );
    return;
  }

  const allowedLeafKeys = new Set(["attr", "op", "value", "valueAttr"]);
  for (const key of keys) {
    if (!allowedLeafKeys.has(key)) {
      state.errors.push(`${path}: unexpected key "${key}" on a leaf node.`);
      return;
    }
  }

  const leaf = raw as AbacLeafNode;
  if (typeof leaf.attr !== "string") {
    state.errors.push(`${path}.attr: must be a string.`);
    return;
  }
  if (typeof leaf.op !== "string") {
    state.errors.push(`${path}.op: must be a string.`);
    return;
  }
  if (leaf.valueAttr !== undefined && typeof leaf.valueAttr !== "string") {
    state.errors.push(`${path}.valueAttr: must be a string.`);
    return;
  }

  validateLeaf(leaf, { path, errors: state.errors });
}

/**
 * Parse + validate an untrusted condition value (from jsonb or an authoring
 * request). Returns the typed AST on success, or a list of human-readable
 * errors on failure. Fail-closed: ANY defect => invalid.
 */
export function parseAbacCondition(raw: unknown): AbacParseResult {
  const state: NodeValidationState = { errors: [], nodeCount: 0 };
  validateNode(raw, "conditions", 0, state);

  if (state.errors.length > 0) {
    return { valid: false, errors: state.errors };
  }
  return { valid: true, node: raw as AbacConditionNode };
}

export type AbacPolicyInput = {
  policyCode: string;
  effect: AbacPolicyEffect;
  description?: string | null;
  moduleKey?: string | null;
  activityCode?: string | null;
  action?: string | null;
  resourceType?: string | null;
  dslVersion?: number;
  priority?: number;
  conditions: unknown;
};

export type AbacPolicyValidated = {
  policyCode: string;
  effect: AbacPolicyEffect;
  description: string | null;
  moduleKey: string | null;
  activityCode: string | null;
  action: string | null;
  resourceType: string | null;
  dslVersion: number;
  priority: number;
  conditions: AbacConditionNode;
};

export type AbacPolicyValidation =
  | { valid: true; value: AbacPolicyValidated }
  | { valid: false; errors: string[] };

const POLICY_CODE_PATTERN = /^[a-z0-9][a-z0-9_.-]{1,98}[a-z0-9]$/i;

function normalizeNullableString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Whether a condition is TRIVIALLY, structurally true — an empty `allOf`
 * (`{"allOf":[]}`, the migration default, vacuously true). This is a DELIBERATELY
 * narrow, syntactic check, NOT a general tautology detector: a hand-crafted
 * always-true condition (e.g. `{anyOf:[{allOf:[]}]}` or `not: anyOf:[]`) is not
 * matched here on purpose. Authoring such a policy is a self-inflicted admin
 * action of the same class as deleting every role — the base rejects only the
 * obvious empty-`allOf` footgun that the flat-CRUD default would otherwise
 * mint (see the Part-B guard in `validateAbacPolicyInput` + ADR-0033 §3).
 */
function isTriviallyTrueCondition(node: AbacConditionNode): boolean {
  return (
    "allOf" in node && Array.isArray(node.allOf) && node.allOf.length === 0
  );
}

/**
 * Validate a full policy authoring payload. Enforces: a sane policy_code, a
 * known effect, a supported dsl_version, a bounded priority, and — the crux —
 * a valid condition AST. Only a payload that passes here may be stored/enabled
 * (the CRUD endpoint calls this before every INSERT/UPDATE), so an invalid
 * policy can never become active.
 */
export function validateAbacPolicyInput(raw: unknown): AbacPolicyValidation {
  const errors: string[] = [];

  if (!isPlainObject(raw)) {
    return { valid: false, errors: ["Body must be a JSON object."] };
  }

  const policyCode =
    typeof raw.policyCode === "string" ? raw.policyCode.trim() : "";
  if (!POLICY_CODE_PATTERN.test(policyCode)) {
    errors.push(
      "policyCode must be 3-100 chars, alphanumerics plus . _ - (not at the edges)."
    );
  }

  const effect = raw.effect;
  if (effect !== "allow" && effect !== "deny") {
    errors.push('effect must be "allow" or "deny".');
  }

  let dslVersion = ABAC_DSL_VERSION;
  if (raw.dslVersion !== undefined) {
    if (
      typeof raw.dslVersion !== "number" ||
      !Number.isInteger(raw.dslVersion) ||
      raw.dslVersion < 1
    ) {
      errors.push("dslVersion must be a positive integer.");
    } else if (raw.dslVersion > ABAC_DSL_VERSION) {
      errors.push(
        `dslVersion ${raw.dslVersion} is newer than supported version ${ABAC_DSL_VERSION}.`
      );
    } else {
      dslVersion = raw.dslVersion;
    }
  }

  let priority = 100;
  if (raw.priority !== undefined) {
    if (
      typeof raw.priority !== "number" ||
      !Number.isInteger(raw.priority) ||
      raw.priority < 0 ||
      raw.priority > 1_000_000
    ) {
      errors.push("priority must be an integer between 0 and 1000000.");
    } else {
      priority = raw.priority;
    }
  }

  for (const field of [
    "moduleKey",
    "activityCode",
    "action",
    "resourceType"
  ] as const) {
    const value = raw[field];
    if (value !== undefined && value !== null && typeof value !== "string") {
      errors.push(`${field} must be a string or null.`);
    }
  }

  const parsed = parseAbacCondition(raw.conditions);
  if (!parsed.valid) {
    errors.push(...parsed.errors);
  }

  // Defense-in-depth (ADR-0033 §3, Part B): reject a policy that is
  // SIMULTANEOUSLY effect=deny, UNSCOPED (all four applicability fields
  // wildcard/absent), and UNCONDITIONAL (a trivially-true empty allOf). Such a
  // policy matches EVERY request and denies it — bricking the whole tenant AND
  // the operator's own access_control.configure / the disable endpoint (same
  // chokepoint), leaving no in-band recovery. A SCOPED deny, a wildcard deny
  // WITH a real condition, and any allow are all unaffected. This is a targeted
  // guard against the trivial empty-allOf case only, not general tautology
  // detection (see isTriviallyTrueCondition + the ADR residual note).
  if (
    effect === "deny" &&
    parsed.valid &&
    normalizeNullableString(raw.moduleKey) === null &&
    normalizeNullableString(raw.activityCode) === null &&
    normalizeNullableString(raw.action) === null &&
    normalizeNullableString(raw.resourceType) === null &&
    isTriviallyTrueCondition(parsed.node)
  ) {
    errors.push(
      "An unscoped, unconditional deny policy would deny every request for the tenant — scope it (set at least one of moduleKey/activityCode/action/resourceType) or add a condition."
    );
  }

  if (errors.length > 0 || !parsed.valid) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      policyCode,
      effect: effect as AbacPolicyEffect,
      description: normalizeNullableString(raw.description),
      moduleKey: normalizeNullableString(raw.moduleKey),
      activityCode: normalizeNullableString(raw.activityCode),
      action: normalizeNullableString(raw.action),
      resourceType: normalizeNullableString(raw.resourceType),
      dslVersion,
      priority,
      conditions: parsed.node
    }
  };
}

/** Input to the read-only policy simulation/preview. Every field describes a
 * HYPOTHETICAL request — none of it mutates anything. `subject.roles` are role
 * CODES resolved server-side into the permission set they would grant;
 * `resourceAttributes` are treated as server-verified facts (the simulation
 * makes clear they are hypothetical). */
export type AbacSimulationValidated = {
  subject: { tenantUserId: string | null; roles: string[] };
  request: {
    moduleKey: string;
    activityCode: string;
    action: string;
    resourceType: string | null;
    resourceAttributes: Record<string, unknown>;
  };
  environment: { ipTrusted: boolean; now: string | null };
};

export type AbacSimulationValidation =
  | { valid: true; value: AbacSimulationValidated }
  | { valid: false; errors: string[] };

export function validateAbacSimulationInput(
  raw: unknown
): AbacSimulationValidation {
  const errors: string[] = [];

  if (!isPlainObject(raw)) {
    return { valid: false, errors: ["Body must be a JSON object."] };
  }

  const request = isPlainObject(raw.request) ? raw.request : undefined;
  if (!request) {
    errors.push("request is required.");
  }

  const moduleKey =
    request && typeof request.moduleKey === "string"
      ? request.moduleKey.trim()
      : "";
  const activityCode =
    request && typeof request.activityCode === "string"
      ? request.activityCode.trim()
      : "";
  const action =
    request && typeof request.action === "string" ? request.action.trim() : "";

  if (!moduleKey) errors.push("request.moduleKey is required.");
  if (!activityCode) errors.push("request.activityCode is required.");
  if (!action) errors.push("request.action is required.");

  let resourceAttributes: Record<string, unknown> = {};
  if (request && request.resourceAttributes !== undefined) {
    if (!isPlainObject(request.resourceAttributes)) {
      errors.push("request.resourceAttributes must be an object.");
    } else {
      resourceAttributes = request.resourceAttributes;
    }
  }

  const subject = isPlainObject(raw.subject) ? raw.subject : {};
  let roles: string[] = [];
  if (subject.roles !== undefined) {
    if (
      !Array.isArray(subject.roles) ||
      !subject.roles.every((role) => typeof role === "string")
    ) {
      errors.push("subject.roles must be an array of strings.");
    } else {
      roles = subject.roles as string[];
    }
  }

  const tenantUserId =
    typeof subject.tenantUserId === "string" && subject.tenantUserId.length > 0
      ? subject.tenantUserId
      : null;

  const environment = isPlainObject(raw.environment) ? raw.environment : {};
  let ipTrusted = false;
  if (environment.ipTrusted !== undefined) {
    if (typeof environment.ipTrusted !== "boolean") {
      errors.push("environment.ipTrusted must be a boolean.");
    } else {
      ipTrusted = environment.ipTrusted;
    }
  }
  let now: string | null = null;
  if (environment.now !== undefined) {
    if (
      typeof environment.now !== "string" ||
      !isIsoDateString(environment.now)
    ) {
      errors.push("environment.now must be an ISO 8601 date string.");
    } else {
      now = environment.now;
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      subject: { tenantUserId, roles },
      request: {
        moduleKey,
        activityCode,
        action,
        resourceType:
          request && typeof request.resourceType === "string"
            ? request.resourceType
            : null,
        resourceAttributes
      },
      environment: { ipTrusted, now }
    }
  };
}
