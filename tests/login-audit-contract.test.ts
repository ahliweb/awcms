import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

/**
 * Issue #145 — the login route's audit contract.
 *
 * A static gate, deliberately: the audit rows themselves are written inside a
 * tenant transaction against a live PostgreSQL, and this repo has no
 * integration harness to exercise that (see `docs/awcms/07_*`). What CAN be
 * pinned without one is the property the issue is actually about — that the
 * route audits both outcomes at all, and that the two identifiers the issue
 * forbids never reach an audit attribute. It mirrors the text-based contract
 * gates this repo already relies on (`scripts/logging-lint-check.ts`,
 * `scripts/changeset-policy-check.ts`).
 *
 * It is a floor, not proof of correctness: it cannot show the row commits.
 * Pair it with an integration test once one exists.
 */
const LOGIN_ROUTE = "src/pages/api/v1/auth/login.ts";

async function readLoginRoute(): Promise<string> {
  return readFile(new URL(`../${LOGIN_ROUTE}`, import.meta.url), "utf8");
}

describe("login route audit contract (Issue #145)", () => {
  test("audits both outcomes — the gap was zero audit rows on either path", async () => {
    const source = await readLoginRoute();

    expect(source).toContain("recordAuditEvent");
    expect(source).toContain('action: "login_succeeded"');
    expect(source).toContain('action: "login_failed"');
  });

  test("attributes the source via the client fingerprint, not a raw IP", async () => {
    const source = await readLoginRoute();

    expect(source).toContain("hashClientIp");
    expect(source).toContain("summarizeUserAgent");
    expect(source).toContain("ipHash");
  });

  test("never persists the raw client IP under an audit attribute", async () => {
    const source = await readLoginRoute();
    const auditContextType = extractBlock(source, "type LoginAuditContext = {");

    expect(auditContextType).toContain("ipHash");
    expect(auditContextType).not.toMatch(/\bip:\s/);
    expect(auditContextType).not.toContain("clientIp:");
  });

  test("never persists loginIdentifier — an attacker-supplied email in a failed-attempt row is the enumeration leak the issue forbids", async () => {
    const source = await readLoginRoute();
    const auditContextBuilder = extractBlock(
      source,
      "function buildLoginAuditContext("
    );

    expect(auditContextBuilder).not.toContain("loginIdentifier");
    expect(auditContextBuilder).not.toContain("password");
  });

  test("covers the rolled-back transaction, whose in-transaction audit row would be lost", async () => {
    const source = await readLoginRoute();

    expect(source).toContain("recordLoginFailureOutOfBand");
    // The original error must be rethrown, never swallowed by the audit path.
    expect(source).toContain("throw error;");
  });
});

/** The braced block starting at `header`, up to its matching closing brace. */
function extractBlock(source: string, header: string): string {
  const start = source.indexOf(header);
  expect(start).toBeGreaterThan(-1);

  let depth = 0;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];

    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }

  throw new Error(`Unbalanced block for header: ${header}`);
}
