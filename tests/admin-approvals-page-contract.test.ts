/**
 * `/admin/approvals` gates against the endpoints it drives.
 *
 * Sibling of `admin-data-lifecycle-page-contract.test.ts` and
 * `admin-reporting-page-contract.test.ts`, for the same silent failure: a page
 * gating on a permission key no migration seeds hides the control from everyone
 * — including the owner — while still looking like a working screen. This repo
 * has shipped that bug twice by inventing a plausible action name.
 *
 * `workflow_approval` sets two fresh traps for it:
 *
 * - **The module key is `workflow`, not `workflow_approval`.** The directory,
 *   the README and the descriptor's own name all say "workflow approval"; the
 *   permission namespace does not. `workflow_approval.approval.read` reads
 *   perfectly and matches nothing.
 * - **Approve and reject share ONE permission**, `approval.approve` — the
 *   permission is the ability to decide, not the direction. A page that gated
 *   its Reject button on `approval.reject` would hide it from every approver.
 *
 * It also pins the deliberate SCOPE of this screen: the six `definition.*`
 * permissions belong to a future definitions screen, and this test fails if
 * they quietly leak into this one — the difference between a decision that was
 * made and a gap nobody noticed.
 *
 * Pure — no database, no network. Runs in `quality` on every PR.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";

const PAGE = "src/pages/admin/approvals.astro";
const ROUTES = [
  "src/pages/api/v1/workflows/tasks/index.ts",
  "src/pages/api/v1/workflows/tasks/[id]/decisions.ts",
  "src/pages/api/v1/workflows/tasks/[id]/reassign.ts",
  "src/pages/api/v1/workflows/tasks/[id]/force-decision.ts",
  "src/pages/api/v1/workflows/instances/[id].ts",
  "src/pages/api/v1/workflows/instances/[id]/cancel.ts",
  "src/pages/api/v1/workflows/delegations/index.ts",
  "src/pages/api/v1/workflows/delegations/[id]/revoke.ts"
];

type Triple = `${string}.${string}.${string}`;

/**
 * These routes declare their guard as a module-level const spanning several
 * lines — `{ moduleKey: "workflow", activityCode: "recovery", action: "cancel"
 * as const }` — so the pattern tolerates newlines and the `as const` suffix.
 */
function guardTriplesFrom(source: string): Set<Triple> {
  const found = new Set<Triple>();
  const pattern =
    /moduleKey:\s*"([a-z_]+)",\s*activityCode:\s*"([a-z_]+)",\s*action:\s*"([a-z_]+)"/g;

  for (const match of source.matchAll(pattern)) {
    found.add(`${match[1]}.${match[2]}.${match[3]}` as Triple);
  }

  return found;
}

/** `permissionKey("workflow", "recovery", "force_decide")` → the same shape. */
/**
 * Both spellings, and issue #450 is why the second exists: a screen routed
 * through `loadAdminScreen` states its guards as `AccessRequest` object
 * literals — the SAME shape the routes use — instead of `permissionKey(...)`.
 *
 * Reading only the old spelling would have made this test demand the screen
 * keep deciding access from the raw grant set, which is the defect. A contract
 * test pins the PROPERTY, never the syntax that happened to express it.
 */
function pageTriplesFrom(source: string): Set<Triple> {
  const found = new Set<Triple>();

  for (const match of source.matchAll(
    /permissionKey\(\s*"([a-z_]+)",\s*"([a-z_]+)",\s*"([a-z_]+)"\s*\)/g
  )) {
    found.add(`${match[1]}.${match[2]}.${match[3]}` as Triple);
  }

  for (const match of source.matchAll(
    /moduleKey:\s*"([a-z_]+)",\s*activityCode:\s*"([a-z_]+)",\s*action:\s*"([a-z_]+)"/g
  )) {
    found.add(`${match[1]}.${match[2]}.${match[3]}` as Triple);
  }

  return found;
}

function declaredTriples(): Set<Triple> {
  return new Set<Triple>(
    (listModules()
      .find((module) => module.key === "workflow")
      ?.permissions?.map(
        (permission) =>
          `workflow.${permission.activityCode}.${permission.action}`
      ) ?? []) as Triple[]
  );
}

const PAGE_KEYS = [
  "workflow.approval.approve",
  "workflow.approval.read",
  "workflow.delegation.create",
  "workflow.delegation.read",
  "workflow.delegation.revoke",
  "workflow.recovery.cancel",
  "workflow.recovery.force_decide",
  "workflow.recovery.reassign"
] as const;

const DEFINITION_KEYS = [
  "workflow.definition.create",
  "workflow.definition.delete",
  "workflow.definition.publish",
  "workflow.definition.read",
  "workflow.definition.retire",
  "workflow.definition.update"
] as const;

describe("/admin/approvals permission gates", () => {
  test("the module key is `workflow`, which is what the descriptor declares", () => {
    // The one assertion that would have caught the whole class at once: every
    // other test here builds on this namespace being right.
    const declared = declaredTriples();

    expect(declared.size).toBe(14);
    expect(declared.has("workflow.approval.read")).toBe(true);
    expect(
      listModules().some((module) => module.key === "workflow_approval")
    ).toBe(false);
  });

  test("every key the page gates on is one its endpoints actually enforce", async () => {
    const pageKeys = pageTriplesFrom(await readFile(PAGE, "utf8"));
    expect(pageKeys.size).toBe(PAGE_KEYS.length);

    const enforced = new Set<Triple>();
    for (const route of ROUTES) {
      for (const triple of guardTriplesFrom(await readFile(route, "utf8"))) {
        enforced.add(triple);
      }
    }

    // Guards really were parsed — an empty `enforced` would make the subset
    // check pass vacuously, the shape of gate this repo has been burned by.
    expect(enforced.size).toBeGreaterThan(0);

    // `decisions.ts` is the one route whose guard is assembled in two pieces
    // (`GUARD_ACTIVITY` plus a literal `action`), so the regex above cannot see
    // it. Assert it directly rather than letting it fall through the subset
    // check as an unenforced key.
    const decisions = await readFile(ROUTES[1]!, "utf8");
    expect(decisions).toContain('moduleKey: "workflow"');
    expect(decisions).toContain('activityCode: "approval"');
    expect(decisions).toContain('action: "approve" as const');
    enforced.add("workflow.approval.approve");

    expect([...pageKeys].filter((key) => !enforced.has(key))).toEqual([]);
  });

  test("and is declared by the module descriptor, so a migration seeds it", async () => {
    const declared = declaredTriples();
    const missing = [...pageTriplesFrom(await readFile(PAGE, "utf8"))].filter(
      (key) => !declared.has(key)
    );

    expect(missing).toEqual([]);
  });

  test("the page claims exactly the inbox/recovery/delegation eight", async () => {
    const pageKeys = pageTriplesFrom(await readFile(PAGE, "utf8"));

    expect([...pageKeys].sort()).toEqual([...PAGE_KEYS]);
  });

  test("the six definition.* permissions stay out — a screen, not a gap", async () => {
    const pageKeys = pageTriplesFrom(await readFile(PAGE, "utf8"));

    // Every one of them is a real, seeded permission this page could have
    // gated on. Leaving them out is a decision (definitions need a graph
    // editor); this assertion is what keeps it a decision rather than an
    // oversight, and it turns red the moment a definitions surface is added
    // here instead of on its own screen.
    const declared = declaredTriples();
    for (const key of DEFINITION_KEYS) {
      expect(declared.has(key)).toBe(true);
      expect(pageKeys.has(key)).toBe(false);
    }
  });

  test("reject shares approve's permission — there is no approval.reject", async () => {
    const page = await readFile(PAGE, "utf8");

    expect(declaredTriples().has("workflow.approval.reject" as Triple)).toBe(
      false
    );
    // Both buttons render under the same gate, so the page must not mention a
    // second decision permission at all.
    expect(page).toContain('data-decision="approve"');
    expect(page).toContain('data-decision="reject"');
    expect(page).not.toContain('"approval", "reject"');
  });

  test("the page never mutates directly — it posts to the guarded endpoints", async () => {
    const page = await readFile(PAGE, "utf8");

    // No SQL write anywhere in the screen: every change goes out over fetch, so
    // the endpoints' audit rows, idempotency records and decision logs cannot
    // be bypassed by a screen that writes for itself.
    expect(page).not.toMatch(
      /\b(INSERT\s+INTO|UPDATE\s+awcms_|DELETE\s+FROM)/i
    );

    expect(page).toContain("/api/v1/workflows/tasks/${taskId}/decisions`");
    expect(page).toContain("/api/v1/workflows/tasks/${taskId}/reassign`");
    expect(page).toContain("/api/v1/workflows/tasks/${taskId}/force-decision`");
    expect(page).toContain("/api/v1/workflows/instances/${instanceId}/cancel`");
    expect(page).toContain("/api/v1/workflows/delegations/${id}/revoke`");
    expect(page).toContain('"/api/v1/workflows/delegations"');
  });

  test("all six mutations carry an Idempotency-Key, because all six require one", async () => {
    const page = await readFile(PAGE, "utf8");

    // Unlike `/admin/reporting`, there is no exception here: every mutating
    // endpoint this page calls answers `IDEMPOTENCY_REQUIRED` without the
    // header, so a call that omitted it would render a control that always
    // fails.
    // Lookbehind excludes the helper's own declaration, so this counts CALL
    // SITES — six mutations, six headers.
    expect(page.match(/(?<!function )idempotency\(\)/g)).toHaveLength(6);
    expect(page).toContain('"Idempotency-Key": crypto.randomUUID()');

    for (const route of ROUTES.slice(1)) {
      const source = await readFile(route, "utf8");
      if (!source.includes("export const POST")) continue;
      expect(source).toContain("IDEMPOTENCY_REQUIRED");
    }
  });

  test("form bounds come from the constant the validators enforce", async () => {
    const page = await readFile(PAGE, "utf8");

    expect(page).toContain("MAX_REASON_LENGTH");
    expect(page).toContain("MIN_REASON_LENGTH");
    // The bound was duplicated as a bare `500` in five files; a sixth copy in
    // the markup would drift into a browser accepting what the server rejects.
    expect(page).not.toMatch(/maxlength=\{?"?\d/);

    for (const route of [
      "src/pages/api/v1/workflows/tasks/[id]/reassign.ts",
      "src/pages/api/v1/workflows/tasks/[id]/force-decision.ts",
      "src/pages/api/v1/workflows/instances/[id]/cancel.ts",
      "src/pages/api/v1/workflows/delegations/[id]/revoke.ts",
      "src/modules/workflow-approval/domain/workflow-delegation.ts"
    ]) {
      const source = await readFile(route, "utf8");
      expect(source).toContain("reason-bounds");
      expect(source).not.toContain("MAX_REASON_LENGTH = 500");
    }
  });

  test("the sidebar entry points at this page and is gated on a real permission", () => {
    const nav = listModules()
      .find((module) => module.key === "workflow")
      ?.navigation?.find((entry) => entry.path === "/admin/approvals");

    expect(nav).toBeDefined();
    expect(nav!.requiredPermission).toBe("workflow.approval.read");
    expect(declaredTriples().has(nav!.requiredPermission as Triple)).toBe(true);
    // `admin-navigation-registry.test.ts` already binds path→file and
    // labelKey→SIDEBAR_LABELS; this pins the gate specifically.
  });
});
