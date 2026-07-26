/**
 * Structural contracts for `checkSsoBreakGlassReady` — the properties that make
 * it worth having, none of which a runtime assertion can observe.
 *
 * The integration suite proves the check reports the right answer. It cannot
 * prove the check is REACHED (a function nobody calls has no behaviour to test)
 * or that it derives its answer from the same rule the write path enforces
 * rather than a second copy that happens to agree today. Both of those are
 * facts about the source, so they are asserted against the source.
 *
 * No database — this runs in `quality` on every PR, where the integration
 * suite does not.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

const SCRIPT = "scripts/security-readiness.ts";
const POLICY = "src/modules/identity-access/application/tenant-auth-policy.ts";

describe("the break-glass readiness check", () => {
  test("is actually in the list the runner executes", async () => {
    const source = await readFile(SCRIPT, "utf8");
    const runner = source.slice(
      source.indexOf("export async function runSecurityReadinessChecks")
    );

    // Exported-but-unregistered is the whole failure mode: `security:readiness`
    // would keep printing a clean bill of health with this check never running.
    expect(runner).toContain("await checkSsoBreakGlassReady()");
  });

  test("re-uses the save path's eligibility rule instead of restating it", async () => {
    const source = await readFile(SCRIPT, "utf8");
    const body = source.slice(
      source.indexOf("export async function checkSsoBreakGlassReady"),
      source.indexOf("export function checkTurnstileReady")
    );

    // Asserted at the CALL SITE, not as an import. A mutation that deletes the
    // `fetchEligibleBreakGlassIdentityIds(...)` call and passes
    // `policy.breakGlassIdentityIds.length` straight to the evaluator — i.e.
    // trusting the stored list, the precise bug this check exists to find —
    // leaves the import untouched, so an import-level assertion stays green
    // through it. (Verified: that mutation reddens 4 integration tests and,
    // before this change, 0 contract tests.)
    expect(body).toContain("await fetchEligibleBreakGlassIdentityIds(");
    expect(body).toContain("evaluateBreakGlassRequirement({");
    expect(body).toContain("eligibleBreakGlassCount: eligible.length");

    // ...and no private re-derivation of the predicate alongside them.
    // Asserted as "does not QUERY those tables", not "does not mention them":
    // the check's own pass evidence names `awcms_identities`/`awcms_tenant_users`
    // to tell the operator where eligibility came from, so a bare token search
    // goes red on the explanation instead of on a reimplementation — and a gate
    // that fails for the wrong reason teaches people to delete it.
    const check = source.slice(
      source.indexOf("export async function checkSsoBreakGlassReady"),
      source.indexOf("export function checkTurnstileReady")
    );
    expect(check).not.toMatch(/\b(FROM|JOIN)\s+awcms_identities\b/);
    expect(check).not.toMatch(/\b(FROM|JOIN)\s+awcms_tenant_users\b/);
  });

  test("reads policies through withTenant, so RLS is exercised rather than sidestepped", async () => {
    const source = await readFile(SCRIPT, "utf8");
    const check = source.slice(
      source.indexOf("export async function checkSsoBreakGlassReady"),
      source.indexOf("export function checkTurnstileReady")
    );

    // A direct `SELECT ... FROM awcms_tenant_auth_policies` would return zero
    // rows under FORCE RLS without the tenant GUC — and zero rows reads as
    // "no tenant is locked down", i.e. a silent unconditional PASS.
    expect(check).toContain("withTenant(");
    expect(check).not.toContain("FROM awcms_tenant_auth_policies");
  });

  test("scans every active tenant with no cap", async () => {
    const source = await readFile(SCRIPT, "utf8");
    const check = source.slice(
      source.indexOf("export async function checkSsoBreakGlassReady"),
      source.indexOf("export function checkTurnstileReady")
    );

    expect(check).toContain("FROM awcms_tenants WHERE status = 'active'");
    // A LIMIT here would let a locked-out tenant past the cap go unreported
    // while the check prints PASS.
    expect(check).not.toMatch(/\bLIMIT\b/);
  });

  test("the shared predicate is exported for this caller, and says so", async () => {
    const policy = await readFile(POLICY, "utf8");

    // `fetchEligibleBreakGlassIdentityIds` documents that it is exported FOR
    // security-readiness. That sentence was true of the intent and false of the
    // repo until this check landed; this keeps them from separating again.
    expect(policy).toContain(
      "export async function fetchEligibleBreakGlassIdentityIds"
    );
    expect(policy).toContain("scripts/security-readiness.ts");
  });
});
