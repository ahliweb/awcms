/**
 * Issue #1385 (audit findings F-08/F-09 of the consumer contract-parity audit):
 * the public contract must say `429` (with `Retry-After`) and the
 * `Idempotency-Key` header EXACTLY where a handler applies them.
 *
 * The check is per HANDLER, not a text search for `RATE_LIMITED`: for each
 * exported `GET`/`POST`/`PUT`/`PATCH`/`DELETE` of a route file it follows the
 * handler body through the helper functions it names (same file, then the
 * relative modules it imports, symbol by symbol) and asks whether that call
 * graph reaches
 *
 *  - a rate-limit helper (`checkRateLimit`, `checkSharedRateLimit`,
 *    `checkAuthRateLimit`) -> the operation must declare `429`;
 *  - a `retry-after` header -> a declared `429` must declare `Retry-After`;
 *  - a read of the `Idempotency-Key` request header -> the operation must
 *    reference `IdempotencyKey` or `IdempotencyKeyOptional`, and the other way
 *    round (a declared key the handler never reads is a claim without effect).
 *
 * Symbol-level, because `GET` and `POST` of one file often differ (the limiter
 * sits in the mutation only) and a module such as a route-support file holds
 * both the key reader and helpers that never touch it.
 *
 * Static, no database. The walker is shared with the new-operation policy gate
 * of #1395 (`scripts/api-contract-policy.ts`), which asks the same question.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import {
  RATE_LIMIT_HELPER,
  parseFile,
  reaches,
  routeTemplate,
  routesDir,
  walkTs
} from "../scripts/lib/route-handler-graph";

const ROOT = path.resolve(import.meta.dir, "..");
const ROUTES = routesDir(ROOT);
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

// The call-graph walker and the limiter pattern live in
// `scripts/lib/route-handler-graph.ts` since Issue #1395, which reuses them to
// decide which NEW operations must declare 429.
const LIMITER = RATE_LIMIT_HELPER;
// A `retry-after` header counts only in a function that also builds a `429`,
// so an unrelated `retry-after` elsewhere in a deep call graph (a provider
// client, a queue) does not make a handler "send" it.
const RETRY_AFTER = {
  test: (body: string) => /retry-after/i.test(body) && /\b429\b/.test(body),
  source: "retry-after-with-429"
};
const IDEMPOTENCY_READ = /get\(\s*["']idempotency-key["']\s*\)/i;

type AnyRecord = Record<string, any>;

const bundle = parseYaml(
  readFileSync(path.join(ROOT, "openapi/awcms-public-api.openapi.yaml"), "utf8")
) as AnyRecord;

function resolveRef(node: AnyRecord | undefined): AnyRecord | undefined {
  if (node && typeof node.$ref === "string") {
    const parts = node.$ref.replace(/^#\//, "").split("/");
    return parts.reduce<any>((acc, p) => acc?.[p], bundle);
  }
  return node;
}

type Handler = {
  key: string;
  file: string;
  name: string;
  op: AnyRecord;
  pathItem: AnyRecord;
};

const handlers: Handler[] = [];
for (const file of walkTs(ROUTES)) {
  const template = routeTemplate(file, ROOT);
  const pathItem = bundle.paths?.[template];
  if (!pathItem) continue;
  for (const method of METHODS) {
    const op = pathItem[method.toLowerCase()];
    if (op && parseFile(file).decls.has(method)) {
      handlers.push({
        key: `${method} ${template}`,
        file,
        name: method,
        op,
        pathItem
      });
    }
  }
}

function parameterRefs(h: Handler): string[] {
  return [...(h.pathItem.parameters ?? []), ...(h.op.parameters ?? [])]
    .map((p: AnyRecord) => p.$ref as string | undefined)
    .filter((r): r is string => typeof r === "string");
}

describe("handlers are discovered per method (the checks below are not vacuous)", () => {
  test("a meaningful number of operations are analysed", () => {
    expect(handlers.length).toBeGreaterThan(300);
  });

  test("the call graph tells GET from POST of one file (limiter only in the POST)", () => {
    const file = path.join(ROUTES, "omes/servers/index.ts");
    expect(reaches(LIMITER, file, "POST")).toBe(true);
    expect(reaches(LIMITER, file, "GET")).toBe(false);
  });

  test("the call graph follows an imported helper symbol, and only that symbol", () => {
    const file = path.join(ROUTES, "website-engagement/submissions/index.ts");
    expect(reaches(LIMITER, file, "POST")).toBe(true);
    expect(reaches(LIMITER, file, "GET")).toBe(false);
  });
});

describe("rate limiting is declared where a handler applies it (#1385, F-09)", () => {
  const limited = handlers.filter((h) => reaches(LIMITER, h.file, h.name));

  test("the set of rate-limited operations is not empty", () => {
    expect(limited.length).toBeGreaterThan(40);
  });

  test("every operation whose handler calls a rate-limit helper declares 429", () => {
    const missing = limited
      .filter((h) => !h.op.responses?.["429"])
      .map((h) => h.key);
    expect(missing).toEqual([]);
  });

  test("a 429 whose handler sends Retry-After declares the header (a handler that never sends it must not claim it)", () => {
    const wrong: string[] = [];
    for (const h of handlers) {
      const response = resolveRef(h.op.responses?.["429"]);
      if (!response) continue;
      const declares = Boolean(response.headers?.["Retry-After"]);
      const sends = reaches(RETRY_AFTER, h.file, h.name);
      if (sends && !declares) wrong.push(`${h.key}: sends, does not declare`);
      if (!sends && declares) wrong.push(`${h.key}: declares, never sends`);
    }
    expect(wrong).toEqual([]);
  });

  test("the shared components exist and agree with each other", () => {
    const components = bundle.components;
    expect(components.headers.RetryAfter.schema.type).toBe("integer");
    expect(components.responses.RateLimited.headers["Retry-After"].$ref).toBe(
      "#/components/headers/RetryAfter"
    );
    expect(
      components.responses.RateLimitedNoRetryAfter.headers
    ).toBeUndefined();
  });
});

describe("Idempotency-Key is declared where a handler reads it (#1385, F-08)", () => {
  const KEY_REFS = [
    "#/components/parameters/IdempotencyKey",
    "#/components/parameters/IdempotencyKeyOptional"
  ];
  const reading = handlers.filter((h) =>
    reaches(IDEMPOTENCY_READ, h.file, h.name)
  );

  test("the set of key-reading operations is not empty", () => {
    expect(reading.length).toBeGreaterThan(100);
  });

  test("every operation whose handler reads the header declares it", () => {
    const missing = reading
      .filter((h) => !parameterRefs(h).some((r) => KEY_REFS.includes(r)))
      .map((h) => h.key);
    expect(missing).toEqual([]);
  });

  test("an operation that declares the header has a handler that reads it", () => {
    const claims = handlers
      .filter((h) => parameterRefs(h).some((r) => KEY_REFS.includes(r)))
      .filter((h) => !reaches(IDEMPOTENCY_READ, h.file, h.name))
      .map((h) => h.key);
    expect(claims).toEqual([]);
  });

  test("an operation that applies the key only in some cases uses the optional component", () => {
    const handler = handlers.find(
      (h) => h.key === "PATCH /api/v1/website-engagement/sources/{id}"
    );
    expect(handler).toBeDefined();
    expect(parameterRefs(handler!)).toContain(
      "#/components/parameters/IdempotencyKeyOptional"
    );
    const optional = bundle.components.parameters.IdempotencyKeyOptional;
    expect(optional.required).toBe(false);
    const required = bundle.components.parameters.IdempotencyKey;
    expect(optional.name).toBe(required.name);
    expect(optional.schema).toEqual(required.schema);
  });
});
