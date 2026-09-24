/**
 * Pins every OMES Control Center route file to the EXACT permission it is
 * wired to (Issue ahliweb/omes#198, PR review finding).
 *
 * WHY THIS EXISTS. Neither `tests/omes-control-domain.test.ts` (pure domain
 * logic) nor `tests/integration/omes-control.integration.test.ts` (drives
 * application-layer functions directly, never a route module) imports
 * anything under `src/pages/api/v1/omes/**`. A regression that wired, say,
 * `audit/index.ts` to `OMES_GUARDS.servers.read` instead of
 * `OMES_GUARDS.audit.read` would still pass both suites — every application
 * function would still be exercised correctly, just from behind the wrong
 * gate. `access:permissions:enforcement:check` (ADR-0057 §F) only proves a
 * permission has SOME enforcer somewhere in `src/`, not that THIS route
 * enforces THAT permission.
 *
 * This is a static source-text assertion, in the same spirit as
 * `src/modules/_shared/permission-enforcement-coverage.ts`'s own technique:
 * pure, no database, cheap, and it reads the ACTUAL route file's
 * `authorize:` field rather than trusting a route's own doc comment.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROUTES_ROOT = join(
  import.meta.dir,
  "..",
  "src",
  "pages",
  "api",
  "v1",
  "omes"
);

/** Every HTTP-method export in one file, in source order, each with its body up to the next export (or EOF). */
function extractExportBlocks(source: string): Map<string, string> {
  const blocks = new Map<string, string>();
  const matches = [
    ...source.matchAll(/export const (GET|POST|PUT|PATCH|DELETE) =/g)
  ];

  for (const [index, match] of matches.entries()) {
    const start = match.index!;
    const end = matches[index + 1]?.index ?? source.length;
    blocks.set(match[1]!, source.slice(start, end));
  }

  return blocks;
}

function readRoute(relativePath: string): Map<string, string> {
  const source = readFileSync(join(ROUTES_ROOT, relativePath), "utf8");
  return extractExportBlocks(source);
}

type SimpleCase = {
  file: string;
  method: "GET" | "POST" | "DELETE";
  guard: string;
};

/**
 * Every route wired to a single, static `OMES_GUARDS.<activity>.<action>`
 * literal. `operations/index.ts`'s `POST` is deliberately NOT here — it is a
 * function-of-the-request-body guard (`OMES_OPERATION_GUARD`), asserted
 * separately below.
 */
const SIMPLE_CASES: SimpleCase[] = [
  {
    file: "overview/index.ts",
    method: "GET",
    guard: "OMES_GUARDS.servers.read"
  },
  {
    file: "servers/index.ts",
    method: "GET",
    guard: "OMES_GUARDS.servers.read"
  },
  {
    file: "servers/index.ts",
    method: "POST",
    guard: "OMES_GUARDS.servers.register"
  },
  { file: "servers/[id].ts", method: "GET", guard: "OMES_GUARDS.servers.read" },
  {
    file: "servers/[id].ts",
    method: "DELETE",
    guard: "OMES_GUARDS.servers.delete"
  },
  {
    file: "servers/[id]/enrollment-challenges/index.ts",
    method: "POST",
    guard: "OMES_GUARDS.enrollments.manage"
  },
  {
    file: "servers/[id]/enrollment-challenges/[workerId]/revoke.ts",
    method: "POST",
    guard: "OMES_GUARDS.enrollments.manage"
  },
  {
    file: "deployments/index.ts",
    method: "GET",
    guard: "OMES_GUARDS.deployments.read"
  },
  {
    file: "deployments/[id].ts",
    method: "GET",
    guard: "OMES_GUARDS.deployments.read"
  },
  {
    file: "operations/index.ts",
    method: "GET",
    guard: "OMES_GUARDS.deployments.read"
  },
  {
    file: "operations/[id].ts",
    method: "GET",
    guard: "OMES_GUARDS.deployments.read"
  },
  { file: "jobs/index.ts", method: "GET", guard: "OMES_GUARDS.jobs.read" },
  { file: "jobs/[id].ts", method: "GET", guard: "OMES_GUARDS.jobs.read" },
  {
    file: "jobs/[id]/cancel.ts",
    method: "POST",
    guard: "OMES_GUARDS.jobs.cancel"
  },
  {
    file: "jobs/[id]/approve.ts",
    method: "POST",
    guard: "OMES_GUARDS.jobs.approve"
  },
  { file: "health/index.ts", method: "GET", guard: "OMES_GUARDS.servers.read" },
  {
    file: "backups/index.ts",
    method: "GET",
    guard: "OMES_GUARDS.backups.read"
  },
  { file: "backups/[id].ts", method: "GET", guard: "OMES_GUARDS.backups.read" },
  {
    file: "backups/[id]/restore.ts",
    method: "POST",
    guard: "OMES_GUARDS.backups.restore"
  },
  { file: "audit/index.ts", method: "GET", guard: "OMES_GUARDS.audit.read" }
];

describe("OMES Control Center route -> permission binding (static)", () => {
  test.each(SIMPLE_CASES.map((c) => [c.file, c.method, c.guard] as const))(
    "%s %s is wired to %s",
    (file, method, guard) => {
      const blocks = readRoute(file);
      const block = blocks.get(method);

      expect(block).toBeDefined();
      expect(block).toContain(`authorize: ${guard}`);
    }
  );

  test("every SIMPLE_CASES file/method pair actually exists as an export (no stale entry)", () => {
    const byFile = new Map<string, Set<string>>();
    for (const { file, method } of SIMPLE_CASES) {
      if (!byFile.has(file)) byFile.set(file, new Set());
      byFile.get(file)!.add(method);
    }

    for (const [file, methods] of byFile) {
      const blocks = readRoute(file);
      for (const method of methods) {
        expect(blocks.has(method)).toBe(true);
      }
    }
  });

  describe("operations/index.ts POST (function-of-body guard)", () => {
    const block = readRoute("operations/index.ts").get("POST")!;

    test("is wired to OMES_OPERATION_GUARD, not a static literal", () => {
      expect(block).toBeDefined();
      expect(block).toContain("OMES_OPERATION_GUARD[prepared.input.operation");
    });

    test("falls back to OMES_GUARDS.deployments.read when prepare refused (no operation to pick a guard from)", () => {
      expect(block).toContain(": OMES_GUARDS.deployments.read");
    });
  });
});
