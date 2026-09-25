/**
 * Contract tests for the `/admin/omes/enrollments` screen, Issue
 * ahliweb/omes#233 (parent #195). Sibling of
 * `admin-omes-control-page-contract.test.ts` (#200's five screens) and
 * `admin-omes-control-health-backup-audit-page-contract.test.ts` (#201's
 * three) — same pattern, same standard.
 *
 * Pure — no database, no network. RLS/cross-tenant row isolation, the
 * plaintext-never-persisted guarantee, and single-use challenge issuance are
 * exercised at runtime by
 * `tests/integration/omes-control.integration.test.ts`'s "enrollment
 * directory & cross-tenant enrollment isolation (Issue ahliweb/omes#233)"
 * describe block — never asserted here by matching source text, which would
 * prove only that a query was WRITTEN with a filter, not that a real
 * database with `FORCE ROW LEVEL SECURITY` actually refuses a foreign
 * tenant's row.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";

const PAGE = "src/pages/admin/omes/enrollments.astro";

const ROUTES = [
  "src/pages/api/v1/omes/servers/[id]/enrollment-challenges/index.ts",
  "src/pages/api/v1/omes/servers/[id]/enrollment-challenges/[workerId]/revoke.ts"
];

const APPLICATION_FILES = [
  "src/modules/omes-control/application/enrollment-directory.ts",
  "src/modules/omes-control/application/enrollment-management.ts",
  "src/modules/omes-control/application/server-directory.ts"
];

type Triple = `omes_control.${string}.${string}`;

function guardReferenceTriples(source: string): Set<Triple> {
  const found = new Set<Triple>();

  for (const match of source.matchAll(
    /OMES_GUARDS\.([a-zA-Z]+)\.([a-zA-Z]+)/g
  )) {
    found.add(`omes_control.${match[1]}.${match[2]}` as Triple);
  }

  for (const match of source.matchAll(
    /moduleKey:\s*"omes_control",\s*activityCode:\s*"([a-zA-Z]+)",\s*action:\s*"([a-zA-Z]+)"/g
  )) {
    found.add(`omes_control.${match[1]}.${match[2]}` as Triple);
  }

  return found;
}

function declaredTriples(): Set<Triple> {
  return new Set<Triple>(
    (listModules()
      .find((module) => module.key === "omes_control")
      ?.permissions?.map(
        (permission) =>
          `omes_control.${permission.activityCode}.${permission.action}`
      ) ?? []) as Triple[]
  );
}

describe("the enrollments screen gates on a triple its endpoints actually enforce", () => {
  test("every OMES_GUARDS reference on the page is enforced by both enrollment-challenge routes", async () => {
    const pageSource = await readFile(PAGE, "utf8");
    const pageTriples = guardReferenceTriples(pageSource);

    expect(pageTriples.size).toBeGreaterThan(0);
    expect(pageTriples).toContain("omes_control.enrollments.manage");

    for (const route of ROUTES) {
      const routeSource = await readFile(route, "utf8");
      const enforced = guardReferenceTriples(routeSource);
      expect(enforced.has("omes_control.enrollments.manage")).toBe(true);
    }
  });

  test("enrollments.manage is declared by the module descriptor, so sql/155 seeds it", async () => {
    const declared = declaredTriples();
    expect(declared.has("omes_control.enrollments.manage")).toBe(true);

    const sql155 = await readFile(
      "sql/155_awcms_omes_control_permissions.sql",
      "utf8"
    );
    expect(sql155).toContain("('omes_control', 'enrollments', 'manage',");
  });

  test("the enrollments nav entry requires exactly enrollments.manage", async () => {
    const nav = listModules().find(
      (module) => module.key === "omes_control"
    )?.navigation;
    const entry = (nav ?? []).find(
      (item) => item.path === "/admin/omes/enrollments"
    );

    expect(entry).toBeDefined();
    expect(entry?.requiredPermission).toBe("omes_control.enrollments.manage");
  });
});

describe("the enrollments screen never mutates directly and reuses the existing enrollment endpoints", () => {
  test("no screen executes SQL — every change goes out over fetch to an already-guarded endpoint", async () => {
    const source = await readFile(PAGE, "utf8");
    expect(source).not.toMatch(
      /\b(INSERT\s+INTO|UPDATE\s+awcms_|DELETE\s+FROM)/i
    );
  });

  test("issue and revoke both carry an Idempotency-Key, matching each endpoint's own IDEMPOTENCY_REQUIRED", async () => {
    const page = await readFile(PAGE, "utf8");
    expect(page).toContain('"Idempotency-Key": crypto.randomUUID()');
    expect(page).toContain(
      "/api/v1/omes/servers/${serverRowId}/enrollment-challenges`"
    );
    expect(page).toContain(
      "/api/v1/omes/servers/${serverRowId}/enrollment-challenges/${workerId}/revoke`"
    );

    for (const route of ROUTES) {
      expect(await readFile(route, "utf8")).toContain("IDEMPOTENCY_REQUIRED");
    }
  });

  test("this screen adds no new write path — both mutations target the two endpoints ahliweb/omes#198 already shipped and guards, unmodified by this issue", async () => {
    const issueRoute = await readFile(
      "src/pages/api/v1/omes/servers/[id]/enrollment-challenges/index.ts",
      "utf8"
    );
    const revokeRoute = await readFile(
      "src/pages/api/v1/omes/servers/[id]/enrollment-challenges/[workerId]/revoke.ts",
      "utf8"
    );
    expect(issueRoute).toContain("issueEnrollmentChallengeForServer");
    expect(revokeRoute).toContain("revokeEnrollment");
  });
});

/**
 * Only the `<script>` block's actual code — not the frontmatter/docblock
 * prose above it, which freely discusses `localStorage`, `innerHTML`, etc.
 * in ENGLISH SENTENCES explaining why the code below never does. Matching
 * against the whole file would make this test a word-search over prose
 * instead of a check of behavior.
 */
async function readScriptBlock(): Promise<string> {
  const page = await readFile(PAGE, "utf8");
  const match = page.match(/<script\b[^>]*>([\s\S]*)<\/script\s*>/i);
  if (!match) {
    throw new Error(`${PAGE} has no <script> block to inspect.`);
  }
  return match[1]!;
}

describe("the one-time token is never re-displayable and never persisted in plaintext", () => {
  test("the page renders the revealed token only via messageBox.show() (a textContent assignment), never innerHTML/set:html", async () => {
    const script = await readScriptBlock();
    expect(script).not.toMatch(/\.innerHTML\s*=/);
    expect(script).not.toMatch(/set:html=/);
    // messageBox("enroll-token-msg") is the SAME helper (admin-form-client.ts)
    // every other screen's error/status box uses; its own `show()` is a
    // `textContent` assignment, never innerHTML — see admin-form-client.ts's
    // own `messageBox` implementation, exercised generically elsewhere.
    expect(script).toContain('messageBox("enroll-token-msg")');
    expect(script).toContain("tokenBox.show(");
  });

  test("the raw token is never written to localStorage/sessionStorage and is not retained in a page-level variable beyond the response handler", async () => {
    const script = await readScriptBlock();
    expect(script).not.toMatch(/localStorage\.(setItem|getItem)\(/);
    expect(script).not.toMatch(/sessionStorage\.(setItem|getItem)\(/);
    // No `let`/`var` binding anywhere on the page holds the raw value across
    // callbacks — `result.data.enrollmentChallenge` is read once, inside the
    // single `if` branch that calls `tokenBox.show(...)`, and never assigned
    // to anything else.
    expect(script).not.toMatch(
      /(let|var)\s+\w+\s*=\s*result\.data\?\.enrollmentChallenge/
    );
  });

  test("the token notice is cleared before every new issuance attempt, so a stale reveal is never left on screen alongside a new one", async () => {
    const script = await readScriptBlock();
    expect(script).toContain("tokenBox.clear();");
  });

  test("issuance is NOT followed by mutateAndReload — the reveal-once value must survive the response, matching machine-credentials.astro's own established precedent", async () => {
    const script = await readScriptBlock();
    // The issue handler's own block must not call mutateAndReload — a reload
    // immediately after issuance would discard the one-time value before the
    // operator could copy it.
    const issueHandlerStart = script.indexOf('onAction(".js-issue-tok"');
    const issueHandlerEnd = script.indexOf('onAction(".js-revoke-tok"');
    expect(issueHandlerStart).toBeGreaterThan(-1);
    expect(issueHandlerEnd).toBeGreaterThan(issueHandlerStart);
    const issueHandler = script.slice(issueHandlerStart, issueHandlerEnd);
    expect(issueHandler).not.toContain("mutateAndReload");
  });

  test("revoke, unlike issue, uses mutateAndReload — a revoke response carries nothing secret", async () => {
    const script = await readScriptBlock();
    const revokeHandlerStart = script.indexOf('onAction(".js-revoke-tok"');
    expect(revokeHandlerStart).toBeGreaterThan(-1);
    expect(script.slice(revokeHandlerStart)).toContain("mutateAndReload");
  });

  test("the write-side application module persists only a hash, never the raw challenge (sql/158 discipline)", async () => {
    const source = await readFile(
      "src/modules/omes-control/application/enrollment-management.ts",
      "utf8"
    );
    expect(source).toContain("enrollment_challenge_hash");
    expect(source).toContain("challenge.challengeHash");
    // The raw value is returned to the CALLER (`rawChallenge`) but never
    // appears on the right-hand side of a column assignment in the INSERT.
    expect(source).not.toMatch(/enrollment_challenge_hash[^,]*rawChallenge/);
  });

  test("the read-side directory never selects or exposes the raw challenge or the full public key — only a fingerprint", async () => {
    const source = await readFile(
      "src/modules/omes-control/application/enrollment-directory.ts",
      "utf8"
    );
    // Narrowed to CODE-shaped references (a bare SQL column reference or an
    // identifier), not the docblock's own prose explaining why the column
    // is never selected.
    expect(source).not.toMatch(/e\.enrollment_challenge_hash\b/);
    expect(source).not.toMatch(
      /challenge_expires_at\s+AS\s+challenge_expires_at.*\n.*enrollment_challenge_hash/
    );
    expect(source).not.toMatch(/\brawChallenge\b/);
    expect(source).toContain("fingerprintPublicKey(row.public_key)");
    // The raw key is never assigned straight through to the field a screen
    // renders — it is only ever routed through fingerprintPublicKey first.
    expect(source).not.toMatch(/publicKeyFingerprint:\s*row\.public_key\s*,/);
  });
});

describe("cross-tenant scoping (static half — row-level enforcement is exercised by the #233 integration suite)", () => {
  test("every application-layer read/write this screen consumes is scoped by the caller's tenantId", async () => {
    for (const path of APPLICATION_FILES) {
      const source = await readFile(path, "utf8");
      expect(
        source,
        `${path} must filter by tenant_id = \${tenantId}`
      ).toContain("tenant_id = ${tenantId}");
    }
  });

  test("the screen accepts no tenant identifier from the request — the session's own tenantId is the only source", async () => {
    const source = await readFile(PAGE, "utf8");
    expect(source).not.toMatch(/searchParams\.get\(\s*["']tenant/i);
  });
});
