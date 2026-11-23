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
 * Static, no database. The policy gate of #1395 may absorb this.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import { stripComments } from "../scripts/lib/source-text";

const ROOT = path.resolve(import.meta.dir, "..");
const ROUTES = path.join(ROOT, "src/pages/api/v1");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

const LIMITER = /\b(checkRateLimit|checkSharedRateLimit|checkAuthRateLimit)\(/;
// A `retry-after` header counts only in a function that also builds a `429`,
// so an unrelated `retry-after` elsewhere in a deep call graph (a provider
// client, a queue) does not make a handler "send" it.
const RETRY_AFTER = {
  test: (body: string) => /retry-after/i.test(body) && /\b429\b/.test(body),
  source: "retry-after-with-429"
};
const IDEMPOTENCY_READ = /get\(\s*["']idempotency-key["']\s*\)/i;

type AnyRecord = Record<string, any>;
type Decl = { name: string; body: string };
type Parsed = {
  decls: Map<string, string>;
  imports: Map<string, { file: string; name: string }>;
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory()
      ? walk(full)
      : full.endsWith(".ts")
        ? [full]
        : [];
  });
}

function resolveImport(from: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = path.resolve(path.dirname(from), spec);
  for (const candidate of [`${base}.ts`, path.join(base, "index.ts")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const parsedCache = new Map<string, Parsed>();

function parseFile(file: string): Parsed {
  const cached = parsedCache.get(file);
  if (cached) return cached;
  const source = stripComments(readFileSync(file, "utf8"));
  const decls = new Map<string, string>();
  const starts: Array<{ name: string; index: number }> = [];
  const declRe =
    /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s+(\w+)|(?:const|let|var)\s+(\w+))/gm;
  for (const m of source.matchAll(declRe)) {
    starts.push({ name: (m[1] ?? m[2])!, index: m.index! });
  }
  const list: Decl[] = starts.map((s, i) => ({
    name: s.name,
    body: source.slice(s.index, starts[i + 1]?.index ?? source.length)
  }));
  for (const d of list) decls.set(d.name, d.body);

  const imports = new Map<string, { file: string; name: string }>();
  for (const m of source.matchAll(
    /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)"/g
  )) {
    const resolved = resolveImport(file, m[2]!);
    if (!resolved) continue;
    for (const part of m[1]!.split(",")) {
      const cleaned = part.trim().replace(/^type\s+/, "");
      if (!cleaned) continue;
      const [exported, local] = cleaned.split(/\s+as\s+/);
      imports.set((local ?? exported)!.trim(), {
        file: resolved,
        name: exported!.trim()
      });
    }
  }
  const parsed = { decls, imports };
  parsedCache.set(file, parsed);
  return parsed;
}

function reaches(
  pattern: { test(body: string): boolean; source: string },
  file: string,
  name: string,
  seen = new Set<string>()
): boolean {
  const key = `${pattern.source}|${file}|${name}`;
  if (seen.has(key)) return false;
  seen.add(key);
  const { decls, imports } = parseFile(file);
  const body = decls.get(name);
  if (body === undefined) return false;
  if (pattern.test(body)) return true;
  for (const token of new Set(body.match(/[A-Za-z_$][\w$]*/g) ?? [])) {
    if (token === name) continue;
    if (decls.has(token) && reaches(pattern, file, token, seen)) return true;
    const imported = imports.get(token);
    if (imported && reaches(pattern, imported.file, imported.name, seen)) {
      return true;
    }
  }
  return false;
}

function routeTemplate(file: string): string {
  return (
    "/api/v1/" +
    path
      .relative(ROUTES, file)
      .replace(/\.ts$/, "")
      .replace(/\/index$/, "")
      .replace(/\[([^\]]+)\]/g, "{$1}")
  );
}

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
for (const file of walk(ROUTES)) {
  const template = routeTemplate(file);
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
