/**
 * route-handler-graph.ts -- what a route HANDLER does, found by following the
 * functions it names (Issue #1385 test, absorbed by Issue #1395, ADR-0167).
 *
 * The contract says "this operation is rate-limited" nowhere; the handler does
 * it by calling a limiter helper. So "is this operation rate-limited?" is a
 * question about code, and it is answered the way the #1385 test always did it:
 * per HANDLER (not a text search of the file), symbol by symbol, through the
 * call graph.
 *
 * For each exported `GET`/`POST`/`PUT`/`PATCH`/`DELETE` of a route file under
 * `src/pages/api/v1`, `reaches(pattern, file, "POST")` follows the body of that
 * declaration through every top-level function/constant it names (same file,
 * then the relative modules it imports) and asks whether any body on the way
 * matches `pattern`.
 *
 * ## Detection limits (recorded, not hidden)
 *
 * The analysis is static and textual. It therefore does NOT see:
 *
 * - a limiter applied OUTSIDE a handler's call graph: middleware, an Astro
 *   integration, an edge/proxy rule (today `src/middleware.ts` applies none);
 * - an import through a path alias or a bare specifier (only `./` and `../`
 *   imports are followed), a `export * from` re-export, or a dynamic
 *   `import()`;
 * - a limiter reached through a class method or an object-literal method (only
 *   top-level `function` and `const|let|var` declarations are symbols);
 * - a limiter under a name that is not in `RATE_LIMIT_HELPER` -- a NEW limiter
 *   helper must be added to that pattern, and the test that follows it
 *   (`tests/api-contract-policy.test.ts`) pins the three known names against
 *   the real implementations so a rename cannot go unnoticed;
 * - a limiter that sits on a branch never taken: it is "reachable", which is
 *   the conservative answer for "must declare 429".
 *
 * Direction of the errors: an undetected limiter makes the 429 rule PASS (a
 * missed requirement); a detected-but-unreachable one makes it demand a 429 the
 * handler may not send (an extra requirement). The first is the limit to keep
 * in mind; the gate compensates by failing CLOSED when it cannot find the
 * handler at all (see `api-contract-policy.ts`).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { stripComments } from "./source-text";

export const ROUTE_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/** The rate-limit helpers a handler calls. See the limits above. */
export const RATE_LIMIT_HELPER =
  /\b(checkRateLimit|checkSharedRateLimit|checkAuthRateLimit)\(/;

export interface BodyPattern {
  test(body: string): boolean;
  source: string;
}

type Decl = { name: string; body: string };
type Parsed = {
  decls: Map<string, string>;
  imports: Map<string, { file: string; name: string }>;
};

export function repoRoot(): string {
  return path.resolve(import.meta.dir, "../..");
}

export function routesDir(root = repoRoot()): string {
  return path.join(root, "src/pages/api/v1");
}

export function walkTs(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory()
      ? walkTs(full)
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

export function parseFile(file: string): Parsed {
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

/** Does the call graph of `name` (declared in `file`) reach a body matching `pattern`? */
export function reaches(
  pattern: BodyPattern,
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

export function routeTemplate(file: string, root = repoRoot()): string {
  return (
    "/api/v1/" +
    path
      .relative(routesDir(root), file)
      .replace(/\.ts$/, "")
      .replace(/\/index$/, "")
      .replace(/\[([^\]]+)\]/g, "{$1}")
  );
}

/** The `limiter` pattern in the shape `reaches` takes. */
export const RATE_LIMITED: BodyPattern = {
  test: (body) => RATE_LIMIT_HELPER.test(body),
  source: RATE_LIMIT_HELPER.source
};

export interface RouteHandler {
  /** `METHOD /api/v1/...` */
  key: string;
  method: (typeof ROUTE_METHODS)[number];
  template: string;
  file: string;
}

/**
 * Every exported method handler of every route file, keyed by the OpenAPI path
 * template its file location implies. A handler with no operation in the
 * contract is still listed; the caller decides what to do with it.
 */
export function discoverRouteHandlers(root = repoRoot()): RouteHandler[] {
  const out: RouteHandler[] = [];
  for (const file of walkTs(routesDir(root))) {
    const template = routeTemplate(file, root);
    const { decls } = parseFile(file);
    for (const method of ROUTE_METHODS) {
      if (decls.has(method)) {
        out.push({ key: `${method} ${template}`, method, template, file });
      }
    }
  }
  return out;
}
