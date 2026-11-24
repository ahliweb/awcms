/**
 * api-contract-policy.ts -- `bun run api:contract:policy:check`
 * (Issue #1395, ADR-0167 section 5).
 *
 * Applies the contract policy of ADR-0167 to the operations that are NEW, and
 * only to them. Existing operations are fixed gradually (ADR-0167 section 6),
 * so a gate that held all 742 of them to the policy would be red on day one and
 * would be switched off by the first person it blocked.
 *
 * ## The four rules (for an operation that is not in the baseline)
 *
 * 1. `response-example` -- every successful (2xx) response that has a body
 *    carries a DECLARED example on its media type (`example`, or at least one
 *    `examples.<name>`). That is the example `api:fixtures:generate` uses as
 *    `source: "declared"`; a schema-level `example` is not enough, because it
 *    is the one the generator would have to guess is meant for the whole body.
 * 2. `required-list` -- every object schema with `properties` reachable from a
 *    2xx response has a `required` array. An explicit empty `required: []` is a
 *    statement ("everything here is optional"), absence is not. Instance
 *    validation cannot catch a renamed property in a schema that requires
 *    nothing (report #1379, TV-2); this rule is what closes that.
 * 3. `no-nullable` -- no schema reachable from the request (body or
 *    parameters) or a 2xx response uses `nullable`; null is `type: [X, "null"]`,
 *    which is what OpenAPI 3.1 means. `nullable` is a 3.0 keyword with no effect
 *    in 3.1.
 * 4. `rate-limit-429` -- when the handler is rate-limited, the operation
 *    declares `429`. "Rate-limited" is NOT a text search: it is derived from the
 *    handler's own call graph (`scripts/lib/route-handler-graph.ts`, the walker
 *    behind the #1385 test), i.e. the handler reaches `checkRateLimit`,
 *    `checkSharedRateLimit` or `checkAuthRateLimit`. Its limits are recorded
 *    there. When the route handler of a new operation cannot be found, the rule
 *    FAILS (closed): "undetectable" must not read as "not limited".
 *
 * ## What counts as NEW: a frozen baseline that only shrinks
 *
 * An operation is new when its `operationId` is not in
 * `scripts/api-contract-policy-baseline.ts`, the list of every operation the
 * contract had when this gate landed. The alternatives were weighed in the PR
 * (merge-base diff, fetching the base in CI) and rejected: `bun run check` runs
 * on a shallow checkout with no `origin/main`, so a diff-based definition of
 * "new" needs network or history at check time and silently degrades to "all
 * operations are new" or "none are" when that is missing. The baseline is a
 * committed file: the same answer on every machine and every checkout.
 *
 * The baseline may only SHRINK:
 * - an entry whose operation no longer exists FAILS the gate, so removing an
 *   operation forces the line out and a later operation cannot re-use the id to
 *   inherit its exemption;
 * - `tests/api-contract-policy.test.ts` pins a ceiling on its length, so adding
 *   a line (declaring a new operation "old") is a second, visible edit;
 * - the same test pins that it stays sorted and free of duplicates.
 *
 * An operation with no `operationId`, or one whose `operationId` is declared
 * twice, FAILS: it cannot be told apart from the baseline.
 *
 * ## Shared parts are not the new operation's fault
 *
 * A schema or response under `components` that an existing (baseline)
 * operation also reaches (`ApiMeta`, `Unauthorized`...) is pre-existing and is
 * not held to rules 1-3 when a new operation references it. Components only new
 * operations reach are checked in full. (Consequence: a component first
 * introduced by a new operation and later re-used by an old one stops being
 * checked; that is a limit of the baseline approach, accepted.)
 *
 * ## Exceptions
 *
 * `CONTRACT_POLICY_EXCEPTIONS` (same file as the baseline) waives one RULE of
 * one NEW operation and must carry a reason of substance (at least
 * `MIN_REASON_LENGTH` characters). An exception for a baseline operation, an
 * unknown operation or rule, a duplicate, or one that waives something the
 * operation does not violate, FAILS: an exception that no longer excuses
 * anything is cleaned up, not left to accumulate.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import {
  CONTRACT_POLICY_BASELINE,
  CONTRACT_POLICY_EXCEPTIONS,
  type ContractPolicyException
} from "./api-contract-policy-baseline";
import { isRecord, seg } from "./api-contract-lint";
import { BUNDLED_PATH } from "./openapi-bundle";
import {
  RATE_LIMITED,
  discoverRouteHandlers,
  reaches
} from "./lib/route-handler-graph";

type AnyRecord = Record<string, unknown>;

export const POLICY_RULES = [
  "response-example",
  "required-list",
  "no-nullable",
  "rate-limit-429"
] as const;
export type PolicyRule = (typeof POLICY_RULES)[number];

/** Rules about the baseline or an exception themselves, not about an operation. */
export type BookkeepingRule =
  "operation-id" | "stale-baseline" | "bad-exception" | "unsupported";

export const MIN_REASON_LENGTH = 30;

const HTTP_METHODS = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace"
];

export interface PolicyViolation {
  rule: PolicyRule | BookkeepingRule;
  /** `METHOD /path`, or the baseline/exception subject. */
  operation: string;
  operationId?: string;
  /** JSON pointer into the bundle, when the failure has a location. */
  pointer?: string;
  message: string;
}

export interface PolicyResult {
  /** Operations in the contract. */
  operations: number;
  /** Operations not in the baseline: the ones that were checked. */
  checked: number;
  violations: PolicyViolation[];
}

/**
 * `true` / `false` when the handler of `METHOD template` was found and analysed;
 * `undefined` when no handler could be found for it.
 */
export type RateLimitProbe = (
  method: string,
  template: string
) => boolean | undefined;

export interface PolicyInputs {
  baseline: readonly string[];
  exceptions: readonly ContractPolicyException[];
  isRateLimited: RateLimitProbe;
}

const SCHEMA_CHILD_MAPS = ["properties", "patternProperties"] as const;
const SCHEMA_CHILD_LISTS = ["allOf", "anyOf", "oneOf", "prefixItems"] as const;
const SCHEMA_CHILD_NODES = [
  "items",
  "additionalProperties",
  "not",
  "if",
  "then",
  "else"
] as const;

function resolveRef(
  doc: AnyRecord,
  ref: string
): { pointer: string; node: unknown } | undefined {
  if (!ref.startsWith("#/")) return undefined;
  let node: unknown = doc;
  for (const raw of ref.slice(2).split("/")) {
    const key = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!isRecord(node) || !(key in node)) return undefined;
    node = node[key];
  }
  return { pointer: ref.slice(1), node };
}

/** Is this schema node an object schema that declares properties? */
function declaresProperties(node: AnyRecord): boolean {
  return isRecord(node.properties) && Object.keys(node.properties).length > 0;
}

interface Visit {
  pointer: string;
  node: AnyRecord;
}

/**
 * Walk a schema (or response, or request body) graph from `start`, following
 * `$ref` inside the bundle, calling `onNode` for every schema node. `shared`
 * pointers (reachable from a baseline operation) are not entered.
 */
function walkGraph(
  doc: AnyRecord,
  start: { pointer: string; node: unknown },
  shared: ReadonlySet<string>,
  onNode: (visit: Visit) => void
): void {
  const seen = new Set<string>();
  const go = (pointer: string, node: unknown): void => {
    if (!isRecord(node)) return;
    if (typeof node.$ref === "string") {
      const target = resolveRef(doc, node.$ref);
      if (!target || seen.has(target.pointer) || shared.has(target.pointer))
        return;
      seen.add(target.pointer);
      go(target.pointer, target.node);
      return;
    }
    onNode({ pointer, node });
    for (const key of SCHEMA_CHILD_MAPS) {
      const map = node[key];
      if (isRecord(map)) {
        for (const [name, child] of Object.entries(map)) {
          go(`${pointer}/${key}/${seg(name)}`, child);
        }
      }
    }
    for (const key of SCHEMA_CHILD_LISTS) {
      const list = node[key];
      if (Array.isArray(list)) {
        list.forEach((child, index) => go(`${pointer}/${key}/${index}`, child));
      }
    }
    for (const key of SCHEMA_CHILD_NODES) {
      go(`${pointer}/${key}`, node[key]);
    }
  };
  go(start.pointer, start.node);
}

/** Every schema/response/requestBody pointer reachable from `start` (shared set builder). */
function collectReachable(
  doc: AnyRecord,
  start: unknown,
  startPointer: string,
  into: Set<string>
): void {
  const go = (pointer: string, node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach((child, index) => go(`${pointer}/${index}`, child));
      return;
    }
    if (!isRecord(node)) return;
    if (typeof node.$ref === "string") {
      const target = resolveRef(doc, node.$ref);
      if (!target || into.has(target.pointer)) return;
      into.add(target.pointer);
      go(target.pointer, target.node);
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      go(`${pointer}/${seg(key)}`, child);
    }
  };
  go(startPointer, start);
}

interface OperationRef {
  method: string;
  route: string;
  operation: AnyRecord;
  pointer: string;
  label: string;
  id: string | undefined;
}

function listOperations(doc: AnyRecord): OperationRef[] {
  const out: OperationRef[] = [];
  const paths = isRecord(doc.paths) ? doc.paths : {};
  for (const [route, item] of Object.entries(paths)) {
    if (!isRecord(item)) continue;
    for (const method of HTTP_METHODS) {
      const operation = item[method];
      if (!isRecord(operation)) continue;
      out.push({
        method,
        route,
        operation,
        pointer: `/paths/${seg(route)}/${method}`,
        label: `${method.toUpperCase()} ${route}`,
        id:
          typeof operation.operationId === "string"
            ? operation.operationId
            : undefined
      });
    }
  }
  return out;
}

function isSuccess(status: string): boolean {
  return /^2(\d\d|XX)$/i.test(status);
}

/** The 2xx responses of an operation as `{status, pointer, node}`, `$ref` resolved. */
function successResponses(
  doc: AnyRecord,
  op: OperationRef
): Array<{ status: string; pointer: string; node: unknown }> {
  const out: Array<{ status: string; pointer: string; node: unknown }> = [];
  if (!isRecord(op.operation.responses)) return out;
  for (const [status, response] of Object.entries(op.operation.responses)) {
    if (!isSuccess(status)) continue;
    const here = `${op.pointer}/responses/${seg(status)}`;
    if (isRecord(response) && typeof response.$ref === "string") {
      const target = resolveRef(doc, response.$ref);
      out.push({
        status,
        pointer: target ? target.pointer : here,
        node: target ? target.node : undefined
      });
    } else {
      out.push({ status, pointer: here, node: response });
    }
  }
  return out;
}

function hasDeclaredExample(media: AnyRecord): boolean {
  if ("example" in media) return true;
  return isRecord(media.examples) && Object.keys(media.examples).length > 0;
}

export function checkContractPolicy(
  doc: AnyRecord,
  inputs: PolicyInputs
): PolicyResult {
  const violations: PolicyViolation[] = [];
  const operations = listOperations(doc);
  const baseline = new Set(inputs.baseline);

  if (isRecord(doc.webhooks) && Object.keys(doc.webhooks).length > 0) {
    violations.push({
      rule: "unsupported",
      operation: "webhooks",
      message:
        "the contract declares webhooks; this gate reads `paths` only, so they would be unchecked. Extend the gate before adding one."
    });
  }

  // identity bookkeeping: every operation needs one unique operationId
  const idCount = new Map<string, number>();
  for (const op of operations) {
    if (op.id !== undefined) idCount.set(op.id, (idCount.get(op.id) ?? 0) + 1);
  }
  for (const op of operations) {
    if (op.id === undefined || op.id.length === 0) {
      violations.push({
        rule: "operation-id",
        operation: op.label,
        pointer: op.pointer,
        message:
          "has no operationId, so it cannot be told apart from the baseline"
      });
    } else if ((idCount.get(op.id) ?? 0) > 1) {
      violations.push({
        rule: "operation-id",
        operation: op.label,
        operationId: op.id,
        pointer: op.pointer,
        message: `operationId ${op.id} is declared more than once`
      });
    }
  }

  // the baseline only shrinks: an entry for an operation that is gone is stale
  const liveIds = new Set(operations.flatMap((op) => (op.id ? [op.id] : [])));
  for (const id of baseline) {
    if (!liveIds.has(id)) {
      violations.push({
        rule: "stale-baseline",
        operation: id,
        message: `baseline entry ${id} names no operation in the contract; delete the line (the baseline only shrinks)`
      });
    }
  }

  // components that an existing operation reaches are shared, not the new operation's own
  const shared = new Set<string>();
  for (const op of operations) {
    if (op.id !== undefined && baseline.has(op.id)) {
      collectReachable(doc, op.operation, op.pointer, shared);
    }
  }

  const checkedOps = operations.filter(
    (op) => op.id !== undefined && op.id.length > 0 && !baseline.has(op.id)
  );

  const found = new Map<string, PolicyViolation[]>(); // `${operationId}|${rule}`
  const record = (
    op: OperationRef,
    violation: Omit<PolicyViolation, "operation" | "operationId">
  ): void => {
    const full: PolicyViolation = {
      ...violation,
      operation: op.label,
      operationId: op.id
    };
    const key = `${op.id}|${violation.rule}`;
    found.set(key, [...(found.get(key) ?? []), full]);
  };

  for (const op of checkedOps) {
    // rules 1 and 2: successful responses
    for (const response of successResponses(doc, op)) {
      if (shared.has(response.pointer)) continue;
      if (!isRecord(response.node)) continue;
      const content = isRecord(response.node.content)
        ? response.node.content
        : {};
      for (const [mediaType, media] of Object.entries(content)) {
        if (!isRecord(media) || media.schema === undefined) continue;
        const mediaPointer = `${response.pointer}/content/${seg(mediaType)}`;
        if (!hasDeclaredExample(media)) {
          record(op, {
            rule: "response-example",
            pointer: mediaPointer,
            message: `${response.status} ${mediaType} declares no example (add \`example\` or \`examples\` on the media type)`
          });
        }
        walkGraph(
          doc,
          { pointer: `${mediaPointer}/schema`, node: media.schema },
          shared,
          ({ pointer, node }) => {
            if (declaresProperties(node) && !Array.isArray(node.required)) {
              record(op, {
                rule: "required-list",
                pointer,
                message: `object schema at ${pointer} has properties but no \`required\` list (an explicit \`required: []\` is allowed)`
              });
            }
          }
        );
      }
    }

    // rule 3: nullable in anything the operation sends or successfully returns
    const nullableRoots: Array<{ pointer: string; node: unknown }> = [];
    if (op.operation.requestBody !== undefined) {
      nullableRoots.push({
        pointer: `${op.pointer}/requestBody`,
        node: op.operation.requestBody
      });
    }
    if (Array.isArray(op.operation.parameters)) {
      op.operation.parameters.forEach((p, i) =>
        nullableRoots.push({
          pointer: `${op.pointer}/parameters/${i}`,
          node: p
        })
      );
    }
    for (const response of successResponses(doc, op)) {
      if (shared.has(response.pointer)) continue;
      nullableRoots.push({ pointer: response.pointer, node: response.node });
    }
    const reportedNullable = new Set<string>();
    for (const root of nullableRoots) {
      scanNullable(doc, root.pointer, root.node, shared, (pointer) => {
        if (reportedNullable.has(pointer)) return;
        reportedNullable.add(pointer);
        record(op, {
          rule: "no-nullable",
          pointer,
          message: `\`nullable\` at ${pointer}; write \`type: [X, "null"]\` (OpenAPI 3.1)`
        });
      });
    }

    // rule 4: 429 where the handler is rate-limited
    const template = op.route;
    const limited = inputs.isRateLimited(op.method.toUpperCase(), template);
    const declares429 =
      isRecord(op.operation.responses) && "429" in op.operation.responses;
    if (limited === undefined) {
      record(op, {
        rule: "rate-limit-429",
        pointer: `${op.pointer}/responses`,
        message:
          "no route handler was found for this operation under src/pages/api/v1, so whether it is rate-limited cannot be determined (fail closed). Place the handler where the path implies, or record an exception with the reason."
      });
    } else if (limited && !declares429) {
      record(op, {
        rule: "rate-limit-429",
        pointer: `${op.pointer}/responses`,
        message:
          "the handler is rate-limited (its call graph reaches a limiter helper) but the operation declares no `429` (use components.responses.RateLimited)"
      });
    }
  }

  // exceptions: validate, then apply
  const checkedIds = new Set(checkedOps.map((op) => op.id));
  const seenException = new Set<string>();
  const waived = new Set<string>();
  for (const exception of inputs.exceptions) {
    const subject = `${exception.operationId}/${exception.rule}`;
    const bad = (message: string): void => {
      violations.push({ rule: "bad-exception", operation: subject, message });
    };
    if (!(POLICY_RULES as readonly string[]).includes(exception.rule)) {
      bad(
        `unknown rule "${exception.rule}" (known: ${POLICY_RULES.join(", ")})`
      );
      continue;
    }
    if (seenException.has(subject)) {
      bad("declared twice");
      continue;
    }
    seenException.add(subject);
    if (
      typeof exception.reason !== "string" ||
      exception.reason.trim().length < MIN_REASON_LENGTH
    ) {
      bad(
        `needs a reason of at least ${MIN_REASON_LENGTH} characters that says why the rule does not apply`
      );
      continue;
    }
    if (baseline.has(exception.operationId)) {
      bad(
        "names a baseline operation, which this gate does not check; delete the exception"
      );
      continue;
    }
    if (!checkedIds.has(exception.operationId)) {
      bad("names no operation in the contract; delete the exception");
      continue;
    }
    const key = `${exception.operationId}|${exception.rule}`;
    if (!found.has(key)) {
      bad("waives a rule the operation does not violate; delete the exception");
      continue;
    }
    waived.add(key);
  }

  for (const [key, list] of found) {
    if (!waived.has(key)) violations.push(...list);
  }

  return {
    operations: operations.length,
    checked: checkedOps.length,
    violations
  };
}

/** Report each `nullable` key found in the graph reachable from `root`. */
function scanNullable(
  doc: AnyRecord,
  rootPointer: string,
  root: unknown,
  shared: ReadonlySet<string>,
  onFound: (pointer: string) => void
): void {
  const seen = new Set<string>();
  const go = (pointer: string, node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach((child, index) => go(`${pointer}/${index}`, child));
      return;
    }
    if (!isRecord(node)) return;
    if (typeof node.$ref === "string") {
      const target = resolveRef(doc, node.$ref);
      if (!target || seen.has(target.pointer) || shared.has(target.pointer))
        return;
      seen.add(target.pointer);
      go(target.pointer, target.node);
      return;
    }
    if ("nullable" in node) onFound(`${pointer}/nullable`);
    for (const [key, child] of Object.entries(node)) {
      // example values may legitimately contain a property called `nullable`
      if (
        key === "example" ||
        key === "examples" ||
        key === "default" ||
        key === "enum" ||
        key === "const"
      )
        continue;
      go(`${pointer}/${seg(key)}`, child);
    }
  };
  go(rootPointer, root);
}

/** Probe over the real route files: the call graph of each handler. */
export function createRouteRateLimitProbe(root?: string): RateLimitProbe {
  const handlers = new Map(discoverRouteHandlers(root).map((h) => [h.key, h]));
  return (method, template) => {
    const handler = handlers.get(`${method} ${template}`);
    if (!handler) return undefined;
    return reaches(RATE_LIMITED, handler.file, handler.method);
  };
}

export function formatViolations(result: PolicyResult): string {
  const lines = [
    `api:contract:policy:check FAILED -- ${result.violations.length} violation(s) on ${result.checked} new operation(s) of ${result.operations} (ADR-0167 section 5):`
  ];
  for (const v of result.violations) {
    lines.push(
      `  - [${v.rule}] ${v.operation}${v.operationId ? ` (${v.operationId})` : ""}`
    );
    if (v.pointer) lines.push(`      at ${v.pointer}`);
    lines.push(`      ${v.message}`);
  }
  lines.push(
    "  A new operation must meet the policy; a justified waiver goes in CONTRACT_POLICY_EXCEPTIONS (scripts/api-contract-policy-baseline.ts) with a reason. Never add the operation to the baseline."
  );
  return lines.join("\n");
}

if (import.meta.main) {
  const doc = parseYaml(
    await readFile(path.resolve(process.cwd(), BUNDLED_PATH), "utf8")
  ) as AnyRecord;
  const result = checkContractPolicy(doc, {
    baseline: CONTRACT_POLICY_BASELINE,
    exceptions: CONTRACT_POLICY_EXCEPTIONS,
    isRateLimited: createRouteRateLimitProbe()
  });
  if (result.violations.length > 0) {
    console.error(formatViolations(result));
    process.exitCode = 1;
  } else {
    console.log(
      `api:contract:policy:check OK -- ${result.checked} new operation(s) checked, ${result.operations - result.checked} baseline operation(s) not checked (${result.operations} total).`
    );
  }
}
