/**
 * A cross-module import must be declared, or explicitly excused.
 *
 * ## This test was already assumed to exist
 *
 * `_shared/capability-contract-versions.ts` justifies version-less capability
 * strings by saying "a source-boundary test (`tests/unit/module-boundary.test.ts`)
 * is enough to keep provider and consumer in sync". **That file does not exist
 * in this repository.** The sentence was ported from awcms-mini along with the
 * registry; the test was not. So the stated safety net for the entire
 * capability model was imaginary, and the reference is fixed alongside this
 * file landing.
 *
 * ## What `modules:dag:check` cannot do
 *
 * That gate validates the DECLARED graph — self-dependency, duplicates, missing
 * keys, cycles — from `listModules()` alone, "tanpa I/O" by design. It never
 * reads a single import statement, so a module can import anything it likes as
 * long as it does not write it down. Seven such edges existed when this landed.
 *
 * The failure mode is not theoretical. `domain_event_runtime` imports
 * `reporting` while `reporting` declares `domain_event_runtime` as a
 * dependency: a genuine module-level cycle that the DAG gate reports as a valid
 * DAG, because the half that would close it was never declared. Declaring it
 * truthfully turns that gate red — which is exactly why it stayed undeclared,
 * and exactly why it needs to be written down somewhere that a reader will see.
 *
 * ## Three ways an edge can be legitimate
 *
 * 1. `dependencies` — a lifecycle ordering constraint.
 * 2. `capabilities.consumes[].providedBy` — a source-level relationship that
 *    deliberately does NOT imply ordering (the consumer degrades without it).
 * 3. `FOUNDATION_MODULES` / `DOCUMENTED_EXCEPTIONS` below, each with a reason.
 *
 * Type-only imports are NOT exempt. A type import is still a source-level
 * coupling to another module's shape, which is the thing being tracked; the
 * neutral-ground escape hatch for that is `_shared/ports/`, which this test
 * ignores entirely.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";
import {
  collectClaims,
  resolveOwner,
  routeOf
} from "../scripts/validate-module-routes";

/**
 * Directory name to descriptor key, taken from the IMPORTED descriptor.
 *
 * Two wrong versions preceded this one, both wrong silently:
 *
 * 1. `directory.replaceAll("-", "_")` — `src/modules/workflow-approval/`
 *    declares `key: "workflow"`, so every edge out of that directory resolved
 *    to a key absent from `listModules()`.
 * 2. Grepping `key: "..."` out of the source — four modules (`comments` among
 *    them) assign the key from a constant, so only 17 of 21 directories
 *    resolved and the other four were skipped entirely. `comments` had three
 *    undeclared imports at the time and the gate reported success.
 *
 * Importing the descriptor is the only version that cannot disagree with what
 * the registry actually loads. `moduleCoversEveryDirectory` below asserts the
 * map is complete, because the cost of these mistakes was never a wrong
 * answer — it was a confident empty one.
 */
async function directoryKeyMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  for await (const file of new Bun.Glob("src/modules/*/module.ts").scan({
    cwd: process.cwd(),
    dot: true
  })) {
    const directory = file.split("/")[2]!;
    const exports: Record<string, unknown> = await import(
      `${process.cwd()}/${file}`
    );

    for (const value of Object.values(exports)) {
      const key = (value as { key?: unknown } | null)?.key;

      if (typeof key === "string") {
        map.set(directory, key);
        break;
      }
    }
  }

  return map;
}

/**
 * Modules every other module may call directly without declaring it.
 *
 * `logging` only. Audit logging is cross-cutting infrastructure: five modules
 * call `recordAuditEvent` directly today, and `consumer-registry.ts` documents
 * that as "the same cross-module call other modules already make directly".
 * Requiring a declaration would add a dependency edge from nearly every module
 * to one leaf and say nothing a reader did not already know.
 *
 * Kept to exactly one entry on purpose. The moment this list grows, the gate
 * stops describing the architecture and starts excusing it.
 */
const FOUNDATION_MODULES = new Set(["logging"]);

/**
 * Edges that are real, intentional, and cannot be declared. Each needs a reason
 * a reviewer can disagree with — an entry without one is worse than no gate.
 */
const DOCUMENTED_EXCEPTIONS: {
  from: string;
  to: string;
  reason: string;
}[] = [
  {
    from: "domain_event_runtime",
    to: "reporting",
    reason:
      "`infrastructure/consumer-registry.ts` is designated THE cross-module " +
      "wiring point by `module-contract.ts`'s ProjectionEventSource docs, and " +
      "registers a consumer that increments a `reporting` projection. It cannot " +
      "be a `dependencies` edge: `reporting` already declares " +
      "`domain_event_runtime`, so declaring the reverse is a cycle. It is not a " +
      "capability either — that would require a port in `_shared/ports/`, and " +
      "the registry is a static array read at publish time from inside " +
      "`appendDomainEvent`, so a port would relocate the concrete import rather " +
      "than remove it. Revisit if consumer registration ever becomes lazy."
  },
  {
    from: "tenant_admin",
    to: "identity_access",
    reason:
      "ADR-0086. `platform-bootstrap.ts` already INSERTs into " +
      "`awcms_identities` — it is the recorded owner-exception for that table in " +
      "`modules:table-writes:check` — and since the lockout counter moved onto " +
      "`awcms_principals`, an identity created without a principal link counts " +
      "NO failed logins. Linking is therefore part of creating the identity, not " +
      "a separate concern that could run afterwards: the gap between the two " +
      "would be an account with the brute-force control switched off. It cannot " +
      "be a `dependencies` edge (`identity_access` already declares " +
      "`tenant_admin`, so the reverse is a cycle), and a capability port would " +
      "relocate the concrete import rather than remove it — the principal store " +
      "is the ONLY file permitted to name that table by " +
      "`identity:principal-access:check`, so a port adapter would have to live " +
      "there anyway and be called from here just the same. Revisit if tenant " +
      "bootstrap ever stops writing identity rows itself."
  }
];

/** `from "../../<module-dir>/..."` — the shape a cross-module import takes from inside `src/modules`. */
const CROSS_MODULE_IMPORT = /from\s+"\.\.\/\.\.\/([a-z][a-z0-9-]*)\//g;

/** `from ".../modules/<module-dir>/..."` — the shape it takes from `src/pages`, at any depth. */
const PAGES_MODULE_IMPORT = /from\s+"[^"]*?\/modules\/([a-z][a-z0-9-]*)\//g;

type Edge = { from: string; to: string; file: string; line: number };

/**
 * Modules every ROUTE may import without declaring it.
 *
 * `identity_access` is here and nowhere else. `authorizeInTransaction` is the
 * single authorization chokepoint (Issue #255) and is reached from 184 route
 * files; requiring each owning module to declare an edge to it would add ~20
 * edges that tell a reader nothing they did not already know, and would make
 * `identity_access` a dependency of nearly the whole registry. Inside
 * `src/modules` it is NOT foundational — a module reaching for the guard
 * outside a route is a real coupling.
 */
const ROUTE_FOUNDATION_MODULES = new Set(["logging", "identity_access"]);

async function collectModuleEdges(): Promise<Edge[]> {
  const edges: Edge[] = [];
  const keys = await directoryKeyMap();
  const glob = new Bun.Glob("src/modules/*/**/*.ts");

  for await (const file of glob.scan({ cwd: process.cwd(), dot: true })) {
    const fromDir = file.split("/")[2]!;

    if (fromDir === "_shared") {
      continue;
    }

    const body = await readFile(file, "utf8");

    for (const [index, line] of body.split("\n").entries()) {
      for (const match of line.matchAll(CROSS_MODULE_IMPORT)) {
        const toDir = match[1]!;

        // `_shared` is neutral ground — ports live there precisely so a
        // consumer can depend on a shape without depending on a module.
        if (toDir === "_shared" || toDir === fromDir) {
          continue;
        }

        const from = keys.get(fromDir);
        const to = keys.get(toDir);

        // A directory with no readable `module.ts` is not a module — skip
        // rather than invent a key for it.
        if (!from || !to) {
          continue;
        }

        edges.push({ from, to, file, line: index + 1 });
      }
    }
  }

  return edges;
}

/**
 * The same rule applied to `src/pages`, which is 38k lines — larger than the
 * three biggest modules combined — and was scanned by nothing at all.
 *
 * This half could not be written until Issue #256: attributing a route to a
 * module needed `api.routes`, because `tenant_admin`'s `basePath: "/api/v1"`
 * made every route resolve to it and any accusation would have named the wrong
 * module.
 */
async function collectRouteEdges(): Promise<Edge[]> {
  const edges: Edge[] = [];
  const keys = await directoryKeyMap();
  const { claims } = collectClaims(listModules());
  const glob = new Bun.Glob("src/pages/**/*.{ts,astro}");

  for await (const file of glob.scan({ cwd: process.cwd(), dot: true })) {
    // `/admin/**` renders the shell for every module by design; it is bound to
    // descriptors by `tests/admin-navigation-registry.test.ts` instead.
    const route = routeOf(file);

    if (route === "/admin" || route.startsWith("/admin/")) {
      continue;
    }

    const owner = resolveOwner(route, claims);

    if (!owner) {
      // Platform routes (`/api/v1/health`, `/[...path]`) belong to no module,
      // so there is no declaration to check them against.
      continue;
    }

    const body = await readFile(file, "utf8");

    for (const [index, line] of body.split("\n").entries()) {
      for (const match of line.matchAll(PAGES_MODULE_IMPORT)) {
        const toDir = match[1]!;

        if (toDir === "_shared") {
          continue;
        }

        const to = keys.get(toDir);

        if (!to || to === owner) {
          continue;
        }

        edges.push({ from: owner, to, file, line: index + 1 });
      }
    }
  }

  return edges;
}

async function collectEdges(): Promise<Edge[]> {
  return collectModuleEdges();
}

describe("cross-module imports match the declared module graph", () => {
  test("the directory->key map covers every registered module", async () => {
    // The guard the two earlier bugs needed. A partial map does not fail — it
    // quietly narrows what gets checked, which looks identical to passing.
    const map = await directoryKeyMap();
    const registered = new Set(listModules().map((module) => module.key));
    const mapped = new Set(map.values());

    expect(map.size).toBe(registered.size);
    expect([...registered].filter((key) => !mapped.has(key))).toEqual([]);
  });

  test("every import is declared, foundational, or documented", async () => {
    const modules = listModules();
    const byKey = new Map(modules.map((module) => [module.key, module]));
    const edges = await collectEdges();

    // Guard the scanner: a regex that silently stops matching would make this
    // pass while checking nothing.
    expect(edges.length).toBeGreaterThan(10);

    const excused = new Set(
      DOCUMENTED_EXCEPTIONS.map((entry) => `${entry.from} -> ${entry.to}`)
    );
    const offenders = new Set<string>();

    for (const edge of edges) {
      const module = byKey.get(edge.from);

      if (!module) {
        offenders.add(
          `${edge.file}:${edge.line}: "${edge.from}" is not in listModules().`
        );
        continue;
      }

      const declared = new Set<string>([
        ...(module.dependencies ?? []),
        ...(module.capabilities?.consumes ?? []).map(
          (entry) => entry.providedBy
        )
      ]);

      if (
        declared.has(edge.to) ||
        FOUNDATION_MODULES.has(edge.to) ||
        excused.has(`${edge.from} -> ${edge.to}`)
      ) {
        continue;
      }

      offenders.add(
        `${edge.from} -> ${edge.to} (first seen ${edge.file}:${edge.line}): ` +
          `imported but not declared. Add it to \`dependencies\` (lifecycle ` +
          `ordering) or \`capabilities.consumes\` (source-level, no ordering), ` +
          `or add a DOCUMENTED_EXCEPTIONS entry WITH a reason.`
      );
    }

    expect([...offenders].sort()).toEqual([]);
  });

  test("every documented exception is real and carries a reason", async () => {
    // An exception for an edge that no longer exists is silent rot: it makes
    // the list look considered while excusing nothing.
    const edges = await collectEdges();
    const actual = new Set(edges.map((edge) => `${edge.from} -> ${edge.to}`));
    const stale: string[] = [];

    for (const entry of DOCUMENTED_EXCEPTIONS) {
      if (!actual.has(`${entry.from} -> ${entry.to}`)) {
        stale.push(
          `${entry.from} -> ${entry.to} is excused but no longer imported — remove it.`
        );
      }

      if (entry.reason.trim().length < 40) {
        stale.push(`${entry.from} -> ${entry.to} has no substantive reason.`);
      }
    }

    expect(stale).toEqual([]);
  });

  test("every route's cross-module import is declared by the route's OWNER", async () => {
    // The half that was structurally impossible before Issue #256: attributing
    // a route to a module needed `api.routes`, because `tenant_admin`'s
    // `basePath: "/api/v1"` made every route resolve to it.
    const byKey = new Map(listModules().map((module) => [module.key, module]));
    const edges = await collectRouteEdges();

    // `src/pages` is the largest layer in the repo; a scanner that silently
    // stopped matching would make this pass while checking nothing.
    expect(edges.length).toBeGreaterThan(50);

    const offenders = new Set<string>();

    for (const edge of edges) {
      const module = byKey.get(edge.from);

      if (!module) {
        offenders.add(
          `${edge.file}:${edge.line}: owner "${edge.from}" is not registered.`
        );
        continue;
      }

      const declared = new Set<string>([
        ...(module.dependencies ?? []),
        ...(module.capabilities?.consumes ?? []).map(
          (entry) => entry.providedBy
        )
      ]);

      if (declared.has(edge.to) || ROUTE_FOUNDATION_MODULES.has(edge.to)) {
        continue;
      }

      offenders.add(
        `${edge.from} -> ${edge.to} (first seen ${edge.file}:${edge.line}): a route ` +
          `owned by "${edge.from}" imports "${edge.to}", which "${edge.from}" does not ` +
          "declare. Add it to `dependencies` (lifecycle ordering) or " +
          "`capabilities.consumes` (source-level, no ordering)."
      );
    }

    expect([...offenders].sort()).toEqual([]);
  });

  test("the ROUTE foundation list stays exactly logging + identity_access", async () => {
    // Wider than the module-layer list on purpose, and only that much wider.
    // `identity_access` is excused because the authorization chokepoint is
    // reached from 184 route files; anything else appearing here would mean the
    // gate is being widened to fit a coupling rather than the coupling being
    // declared.
    expect([...ROUTE_FOUNDATION_MODULES].sort()).toEqual([
      "identity_access",
      "logging"
    ]);
  });

  test("the foundation allow-list stays a list of one", async () => {
    // Not style. Every entry here is an edge nobody has to justify, so the list
    // growing is how a boundary gate quietly becomes a rubber stamp.
    expect([...FOUNDATION_MODULES]).toEqual(["logging"]);
  });
});
