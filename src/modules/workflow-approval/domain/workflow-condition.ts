/**
 * Bounded condition evaluation (Issue #747). A `condition` node
 * (`domain/workflow-graph.ts`) compares exactly one declared fact against
 * a literal using one of 7 fixed operators — never an arbitrary
 * expression, template, or tenant-supplied code (doc 21 §3 decision tree,
 * node Q5). `facts` themselves are validated against the definition's
 * `factsSchema` by `validateFactsAgainstSchema` below before a condition
 * is ever evaluated, so a condition node can never be asked to compare
 * against a fact of the wrong type or a fact that was never declared.
 */
import type { ConditionNode, FactDeclaration } from "./workflow-graph";
import type { WorkflowConditionResolver } from "../../_shared/ports/workflow-condition-port";

export type FactValue = string | number | boolean;
export type FactsSnapshot = Record<string, FactValue>;

export type FactsValidationError = { field: string; message: string };
export type FactsValidationResult =
  | { valid: true; value: FactsSnapshot }
  | { valid: false; errors: FactsValidationError[] };

const MAX_FACT_STRING_LENGTH = 512;

/**
 * Validates a caller-supplied `facts` object against the definition's
 * declared `factsSchema` (Issue #747 acceptance criterion: "bounded,
 * schema-validated facts snapshot" — mirrors `domain-event-runtime`'s
 * `validateDomainEventPayload` in spirit: reject unknown/wrong-typed/
 * unbounded input rather than silently coercing it). Extra keys not
 * declared in `factsSchema` are rejected (closed schema, not
 * "additionalProperties: true") — this is what keeps `facts` from ever
 * becoming an arbitrary/unbounded JSON blob.
 */
export function validateFactsAgainstSchema(
  factsInput: unknown,
  factsSchema: readonly FactDeclaration[]
): FactsValidationResult {
  const errors: FactsValidationError[] = [];

  if (
    typeof factsInput !== "object" ||
    factsInput === null ||
    Array.isArray(factsInput)
  ) {
    return {
      valid: false,
      errors: [{ field: "facts", message: "facts must be an object." }]
    };
  }

  const record = factsInput as Record<string, unknown>;
  const declaredKeys = new Set(factsSchema.map((f) => f.key));
  const result: FactsSnapshot = {};

  for (const key of Object.keys(record)) {
    if (!declaredKeys.has(key)) {
      errors.push({
        field: `facts.${key}`,
        message: `"${key}" is not declared in this workflow's factsSchema.`
      });
    }
  }

  for (const fact of factsSchema) {
    const value = record[fact.key];

    if (value === undefined) {
      continue;
    }

    if (fact.type === "string") {
      if (typeof value !== "string" || value.length > MAX_FACT_STRING_LENGTH) {
        errors.push({
          field: `facts.${fact.key}`,
          message: `must be a string of at most ${MAX_FACT_STRING_LENGTH} characters.`
        });
        continue;
      }
    } else if (fact.type === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        errors.push({
          field: `facts.${fact.key}`,
          message: "must be a finite number."
        });
        continue;
      }
    } else if (fact.type === "boolean") {
      if (typeof value !== "boolean") {
        errors.push({
          field: `facts.${fact.key}`,
          message: "must be a boolean."
        });
        continue;
      }
    }

    result[fact.key] = value as FactValue;
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, value: result };
}

/**
 * Evaluates a single bounded comparison, OR — when the node declares
 * `resolverName` — invokes the matching statically-registered
 * `WorkflowConditionResolver` (Issue #747, `_shared/ports/
 * workflow-condition-port.ts`). Returns `false` (routes to `onFalse`)
 * rather than throwing when the fact/resolver is missing — a missing
 * fact or an unregistered resolver name is a safe-default-deny/pause
 * situation per Issue #747's security requirement ("missing facts...
 * defaults to deny/pause"), never a crash that would leave the instance
 * stuck with no audit trail. `resolverName` is validated to exist in the
 * registry at publish time (`validateWorkflowGraph`'s
 * `knownResolverNames`), so reaching "not found" here at runtime would
 * only happen if a resolver was removed from the registry AFTER a
 * definition referencing it was published — a documented, defensive
 * fallback, not the expected path.
 */
export function evaluateCondition(
  node: ConditionNode,
  facts: FactsSnapshot,
  tenantId: string,
  resolvers: readonly WorkflowConditionResolver[] = []
): boolean {
  if (node.resolverName !== undefined) {
    const resolver = resolvers.find((r) => r.name === node.resolverName);
    return resolver ? resolver.evaluate({ tenantId, facts }) : false;
  }

  const factValue =
    node.factKey !== undefined ? facts[node.factKey] : undefined;

  if (factValue === undefined) {
    return false;
  }

  switch (node.operator) {
    case "eq":
      return factValue === node.value;
    case "neq":
      return factValue !== node.value;
    case "gt":
      return (
        typeof factValue === "number" &&
        typeof node.value === "number" &&
        factValue > node.value
      );
    case "gte":
      return (
        typeof factValue === "number" &&
        typeof node.value === "number" &&
        factValue >= node.value
      );
    case "lt":
      return (
        typeof factValue === "number" &&
        typeof node.value === "number" &&
        factValue < node.value
      );
    case "lte":
      return (
        typeof factValue === "number" &&
        typeof node.value === "number" &&
        factValue <= node.value
      );
    case "in":
      return (
        Array.isArray(node.value) &&
        (node.value as Array<string | number>).some((v) => v === factValue)
      );
    default:
      return false;
  }
}
