/**
 * `/admin/business-scope` gates against the endpoints it drives — #545.
 *
 * Sibling of the other page-contract tests, for the same silent failure: a page
 * gating on a permission key no migration seeds hides the control from EVERYONE
 * — including the owner — while still looking like a working screen.
 *
 * Four properties are specific to this surface, and three of them are the
 * reason the issue existed:
 *
 * - **The inbox is HERE, not on `/admin/approvals`.** SoD exceptions do not run
 *   on the `workflow` engine: own table, own state machine, own permissions.
 *   Putting them on the approvals page would gate two unrelated permission
 *   families on one screen and make `identity_access` depend on `workflow`.
 * - **Approve is hidden on BOTH independence axes.** The service refuses when
 *   the approver is the requester AND when the approver is the SUBJECT. A
 *   screen that checked one axis would render a button that always 403s for
 *   the beneficiary.
 * - **The rule picker is DERIVED from the live registry**, and only from rules
 *   whose `exceptionPolicy.allowed` is true. A hand-written list would look
 *   complete on a base with one rule and omit whatever a module contributes.
 * - **Every mutation carries a fresh `Idempotency-Key`.** All six endpoints
 *   answer `IDEMPOTENCY_REQUIRED` without one, so a screen that omitted it
 *   would render six controls that always fail.
 *
 * Pure — no database, no network. Runs in `quality` on every PR.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { stripComments } from "../scripts/access-chokepoint-check";
import { listModules } from "../src/modules";
import { collectSoDRuleDescriptors } from "../src/modules/identity-access/domain/sod-rule-registry";

const PAGE = "src/pages/admin/business-scope.astro";
const APPROVALS_PAGE = "src/pages/admin/approvals.astro";
const ROUTES = [
  "src/pages/api/v1/identity/business-scope/assignments/index.ts",
  "src/pages/api/v1/identity/business-scope/assignments/[id]/revoke.ts",
  "src/pages/api/v1/identity/business-scope/conflicts/index.ts",
  "src/pages/api/v1/identity/business-scope/exceptions/index.ts",
  "src/pages/api/v1/identity/business-scope/exceptions/[id]/approve.ts",
  "src/pages/api/v1/identity/business-scope/exceptions/[id]/reject.ts",
  "src/pages/api/v1/identity/business-scope/exceptions/[id]/revoke.ts"
];

const EXPECTED = [
  "identity_access.business_scope_assignments.create",
  "identity_access.business_scope_assignments.read",
  "identity_access.business_scope_assignments.revoke",
  "identity_access.business_scope_conflicts.read",
  "identity_access.business_scope_exceptions.approve",
  "identity_access.business_scope_exceptions.create",
  "identity_access.business_scope_exceptions.read",
  "identity_access.business_scope_exceptions.reject",
  "identity_access.business_scope_exceptions.revoke"
];

type Triple = `${string}.${string}.${string}`;

function guardTriplesFrom(source: string): Set<Triple> {
  const found = new Set<Triple>();
  const pattern =
    /moduleKey:\s*"([a-z_]+)",\s*activityCode:\s*"([a-z_]+)",\s*action:\s*"([a-z_]+)"/g;

  for (const match of source.matchAll(pattern)) {
    found.add(`${match[1]}.${match[2]}.${match[3]}` as Triple);
  }

  return found;
}

describe("/admin/business-scope gates on keys that really exist", () => {
  test("every key the page claims is DECLARED by a module", async () => {
    const page = await readFile(PAGE, "utf8");
    const claimed = guardTriplesFrom(page);

    const declared = new Set<string>();
    for (const module of listModules()) {
      for (const permission of module.permissions ?? []) {
        declared.add(
          `${module.key}.${permission.activityCode}.${permission.action}`
        );
      }
    }

    // Paired with the subset check so neither can pass on an empty parse.
    expect(claimed.size).toBe(EXPECTED.length);
    for (const key of EXPECTED) {
      expect(claimed.has(key as Triple)).toBe(true);
      expect(declared.has(key)).toBe(true);
    }
  });

  test("and every one of them is ENFORCED by an endpoint this page calls", async () => {
    const enforced = new Set<Triple>();
    for (const route of ROUTES) {
      for (const triple of guardTriplesFrom(await readFile(route, "utf8"))) {
        enforced.add(triple);
      }
    }

    expect(enforced.size).toBeGreaterThan(0);
    expect(EXPECTED.filter((key) => !enforced.has(key as Triple))).toEqual([]);
  });

  test("the page calls each of the six mutating endpoints", async () => {
    const page = await readFile(PAGE, "utf8");

    expect(page).toContain('"/api/v1/identity/business-scope/assignments"');
    expect(page).toContain(
      "/api/v1/identity/business-scope/assignments/${id}/revoke`"
    );
    expect(page).toContain('"/api/v1/identity/business-scope/exceptions"');
    expect(page).toContain(
      "/api/v1/identity/business-scope/exceptions/${id}/${action}`"
    );
    expect(page).toContain(
      "/api/v1/identity/business-scope/exceptions/${id}/revoke`"
    );
  });

  test("every mutation carries a fresh Idempotency-Key", async () => {
    const page = await readFile(PAGE, "utf8");

    // All six endpoints answer `IDEMPOTENCY_REQUIRED` without the header. The
    // helper is counted at its CALL SITES, and the freshness property is held
    // by the assertion above it — a helper that hoisted one key into a
    // constant would turn this red.
    expect(page).toContain(
      'return { "Idempotency-Key": crypto.randomUUID() };'
    );
    // One definition + five call sites: assign, revoke assignment, request an
    // exception, decide one (approve and reject share a wiring function), and
    // revoke one.
    expect(page.match(/idempotency\(\)/g)).toHaveLength(6);
  });
});

describe("the placement decision, which is the point of the issue", () => {
  test("the approvals page does NOT claim any business-scope key", async () => {
    const approvals = await readFile(APPROVALS_PAGE, "utf8");

    // `/admin/approvals` is the decision surface of `workflow_approval`. A
    // business-scope guard appearing there would mean the SoD exception flow
    // had been folded into a page whose vocabulary describes none of it.
    expect(approvals).not.toContain("business_scope");
    expect(approvals).toContain('moduleKey: "workflow"');
  });

  test("and this page does not reach into the workflow module", async () => {
    const page = await readFile(PAGE, "utf8");

    // Merging the two surfaces would make `identity_access` depend on
    // `workflow`, an edge the module DAG does not have.
    expect(page).not.toContain('moduleKey: "workflow"');
    expect(page).not.toContain("workflow-approval");
  });
});

describe("the two independence axes, both of them", () => {
  test("Approve is withheld when the caller is the requester OR the subject", async () => {
    const page = stripComments(await readFile(PAGE, "utf8"));

    // `approveSoDConflictException` refuses both. Checking only the requester
    // axis would render a button that always 403s for the beneficiary — the
    // person most motivated to press it.
    expect(page).toContain(
      "exception.requestedByTenantUserId !== ssr.tenantUserId"
    );
    expect(page).toContain(
      "exception.subjectTenantUserId !== ssr.tenantUserId"
    );
  });

  test("and the service really does refuse both, so the screen is not inventing a rule", async () => {
    const service = stripComments(
      await readFile(
        "src/modules/identity-access/application/sod-exception-service.ts",
        "utf8"
      )
    );

    expect(service).toContain(
      "existing.requested_by_tenant_user_id === actorTenantUserId"
    );
    expect(service).toContain(
      "existing.subject_tenant_user_id === actorTenantUserId"
    );
  });
});

describe("the rule picker is derived, not written down", () => {
  test("no rule key is hard-coded in the page", async () => {
    const page = await readFile(PAGE, "utf8");

    expect(page).toContain("collectSoDRuleDescriptors(listModules())");
    for (const rule of collectSoDRuleDescriptors(listModules())) {
      expect(page).not.toContain(`"${rule.ruleKey}"`);
    }
  });

  test("only rules that ALLOW exceptions reach the picker", async () => {
    const page = await readFile(PAGE, "utf8");

    // The create endpoint refuses a rule whose policy forbids exceptions, so
    // offering one composes a request that fails after the justification is
    // written.
    expect(page).toContain("rule.exceptionPolicy.allowed");
  });

  test("and there is a real rule to derive from, so the assertions above are not vacuous", () => {
    const exceptable = collectSoDRuleDescriptors(listModules()).filter(
      (rule) => rule.exceptionPolicy.allowed
    );

    expect(exceptable.length).toBeGreaterThan(0);
    for (const rule of exceptable) {
      expect(rule.exceptionPolicy.maxDurationDays).toBeGreaterThan(0);
    }
  });
});

describe("the ledger shrank, and stayed shrunk", () => {
  test("no `business_scope` key is left on NOT_YET_SCREENED", async () => {
    const { NOT_YET_SCREENED } =
      await import("../scripts/admin-screen-coverage-ledger");

    expect(
      NOT_YET_SCREENED.filter((key) => key.includes("business_scope"))
    ).toEqual([]);
  });

  test("and the nine keys are exactly the ones this page claims", () => {
    // Paired with the assertion above so neither passes vacuously.
    expect(EXPECTED).toHaveLength(9);
  });
});
