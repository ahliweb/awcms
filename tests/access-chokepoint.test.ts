/**
 * ADR-0063 — the chokepoint rule and its gate.
 *
 * Two things are proven here, and the second is the one that earns the file.
 *
 * 1. `ownershipGrant` widens the permission set WITHOUT weakening anything else.
 *    What makes that safe is that it WIDENS rather than SHORT-CIRCUITS: the
 *    grant only makes `grantedPermissionKeys.has(key)` true, and every other
 *    check in `evaluateAccess` — tenant isolation, ABAC deny, business scope —
 *    still runs and can still refuse.
 *
 *    (An earlier draft of this file claimed the SAFETY came from ABAC being
 *    matched before the RBAC key check. That is wrong, and mutating the order
 *    proved it: a deny returns in either order. The order is irrelevant; not
 *    short-circuiting is the whole property, so that is what is asserted —
 *    including at the guard's source level, since the tempting wrong
 *    implementation is `if (ownership.granted) return allowed` in the guard,
 *    which no test of `evaluateAccess` could ever see.)
 *
 * 2. The gate slices per HANDLER, not per FILE. This is the exact mistake the
 *    assessment that prompted ADR-0063 made: `blog/posts/[id].ts` calls
 *    `authorizeInTransaction` in `GET` and `DELETE`, so a file-level reading —
 *    by a script or by a human skimming — declares it compliant while `PATCH`
 *    in the same file decided permissions on its own.
 */
import { describe, expect, test } from "bun:test";

import {
  findChokepointBypasses,
  findStaleExemptions,
  ADMIN_SCREEN_CHOKEPOINT_MIGRATION,
  findStaleLedgerEntries,
  sliceHandlers,
  sliceScreen
} from "../scripts/access-chokepoint-check";
import {
  evaluateAccess,
  permissionKey
} from "../src/modules/identity-access/domain/access-control";
import type {
  AbacEvaluationInput,
  TenantContext
} from "../src/modules/identity-access/domain/access-control";

const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

const CONTEXT: TenantContext = {
  tenantId: TENANT,
  tenantUserId: USER,
  identityId: "44444444-4444-4444-8444-444444444444",
  roles: ["editor"]
};

const GUARD = {
  moduleKey: "blog_content",
  activityCode: "posts",
  action: "update" as const,
  resourceType: "blog_post",
  resourceId: "post-1"
};

const REQUIRED_KEY = permissionKey(
  GUARD.moduleKey,
  GUARD.activityCode,
  GUARD.action
);

/** Mirrors what the guard does when an ownership grant applies. */
function withOwnership(roleKeys: ReadonlySet<string>): Set<string> {
  return new Set([...roleKeys, REQUIRED_KEY]);
}

describe("ownership grant — widens RBAC, overrules nothing", () => {
  test("without the permission and without ownership, access is denied", () => {
    const decision = evaluateAccess(CONTEXT, GUARD, new Set());

    expect(decision.allowed).toBe(false);
    expect(decision.matchedPolicy).toBe("default_deny");
  });

  test("ownership alone is enough when no policy says otherwise", () => {
    // This is the behaviour the three migrated routes must keep: an author may
    // act on their own unpublished content without holding the permission.
    const decision = evaluateAccess(CONTEXT, GUARD, withOwnership(new Set()));

    expect(decision.allowed).toBe(true);
  });

  test("an explicit ABAC deny still wins over an ownership grant", () => {
    // The load-bearing assertion of ADR-0063: a tenant's explicit deny still
    // refuses an action the ownership grant would otherwise have allowed.
    const abac: AbacEvaluationInput = {
      policies: [
        {
          policyCode: "hold_all_post_updates",
          effect: "deny",
          dslVersion: 1,
          priority: 0,
          applicability: {
            moduleKey: GUARD.moduleKey,
            activityCode: GUARD.activityCode,
            action: GUARD.action,
            resourceType: null
          },
          // `allOf: []` is vacuously true — an UNCONDITIONAL deny for every
          // request in the applicability above.
          condition: { allOf: [] }
        }
      ] as unknown as AbacEvaluationInput["policies"],
      env: { now: new Date("2026-08-04T00:00:00.000Z"), ipTrusted: false }
    };

    const decision = evaluateAccess(
      CONTEXT,
      GUARD,
      withOwnership(new Set()),
      undefined,
      abac
    );

    expect(decision.allowed).toBe(false);
    expect(decision.matchedPolicy).toBe("hold_all_post_updates");
  });

  test("tenant isolation still wins over an ownership grant", () => {
    const decision = evaluateAccess(
      CONTEXT,
      {
        ...GUARD,
        resourceAttributes: { tenantId: "33333333-3333-4333-8333-333333333333" }
      },
      withOwnership(new Set())
    );

    expect(decision.allowed).toBe(false);
    expect(decision.matchedPolicy).toBe("tenant_isolation");
  });
});

describe("the gate slices per handler, not per file", () => {
  // The real shape of `blog/posts/[id].ts` before ADR-0063: two compliant
  // handlers and one bypass, in one file.
  const MIXED_FILE = `
export const GET: APIRoute = async () => {
  const auth = await authorizeInTransaction(tx, tenantId, hash, now, READ_GUARD);
};
export const PATCH: APIRoute = async () => {
  const keys = await fetchGrantedPermissionKeys(tx, tenantId, userId);
};
export const DELETE: APIRoute = async () => {
  const auth = await authorizeInTransaction(tx, tenantId, hash, now, DELETE_GUARD);
};
`;

  test("finds the one bypassing handler among compliant siblings", () => {
    const handlers = sliceHandlers("blog/posts/[id].ts", MIXED_FILE);

    expect(handlers.map((handler) => handler.id)).toEqual([
      "blog/posts/[id].ts#GET",
      "blog/posts/[id].ts#PATCH",
      "blog/posts/[id].ts#DELETE"
    ]);

    const problems = findChokepointBypasses(handlers, {});

    expect(problems).toHaveLength(1);
    expect(problems[0]!.handler).toBe("blog/posts/[id].ts#PATCH");
  });

  test("a file-level reading would have called that file compliant", () => {
    // Stated as a test so the reason for slicing cannot be optimised away.
    expect(MIXED_FILE).toContain("authorizeInTransaction(");
    expect(
      sliceHandlers("blog/posts/[id].ts", MIXED_FILE).some(
        (handler) => handler.decidesPermissions && !handler.usesChokepoint
      )
    ).toBe(true);
  });

  test("defineTenantRoute covers every handler in its file", () => {
    const source = `
const route = defineTenantRoute({ guard: GUARD });
export const POST: APIRoute = async () => {
  const keys = await fetchGrantedPermissionKeys(tx, tenantId, userId);
};
`;

    expect(findChokepointBypasses(sliceHandlers("x.ts", source), {})).toEqual(
      []
    );
  });

  test("an exemption is keyed to one handler and cannot widen to a sibling", () => {
    const handlers = sliceHandlers("blog/posts/[id].ts", MIXED_FILE);
    const problems = findChokepointBypasses(handlers, {
      "blog/posts/[id].ts#POST": "a different handler entirely"
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]!.handler).toBe("blog/posts/[id].ts#PATCH");
  });

  test("a handler that decides nothing needs no chokepoint", () => {
    const source = `
export const GET: APIRoute = async () => {
  return ok(await listPublicThings(tx));
};
`;

    expect(findChokepointBypasses(sliceHandlers("x.ts", source), {})).toEqual(
      []
    );
  });
});

describe("stale exemptions are reported", () => {
  test("an exemption for a handler that no longer bypasses fails", () => {
    const handlers = sliceHandlers(
      "x.ts",
      `
export const POST: APIRoute = async () => {
  const auth = await authorizeInTransaction(tx, t, h, n, G);
  const keys = await fetchGrantedPermissionKeys(tx, t, u);
};
`
    );

    const problems = findStaleExemptions(handlers, {
      "x.ts#POST": "was a bypass once"
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toContain("no longer bypasses");
  });

  test("an exemption for a handler that vanished fails", () => {
    expect(
      findStaleExemptions([], { "gone.ts#POST": "removed route" })
    ).toHaveLength(1);
  });
});

const GUARD_SOURCE_PATH =
  "src/modules/identity-access/application/access-guard.ts";

/**
 * The body of one top-level `export`ed function, so assertions about "inside
 * `authorizeInTransaction`" cannot be satisfied by code in a sibling function
 * or by the `AuthorizeResult` type declaration above it (which legitimately
 * writes `allowed: true;`).
 */
function exportedFunctionBody(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}(`);

  // Not a soft failure: a rename here would make every assertion below range
  // over an empty string and pass vacuously — the exact defect Issue #425 is
  // about, reproduced inside its own fix.
  expect(start).toBeGreaterThan(-1);

  const rest = source.slice(start + 1);
  const nextExport = rest.search(
    /\nexport (?:async function|function|type|const)\s/
  );

  return nextExport === -1 ? rest : rest.slice(0, nextExport);
}

describe("the guard widens, it never short-circuits", () => {
  /**
   * Issue #425 — this was asserted with two `not.toMatch` regexes keyed on the
   * literals `ownershipGrant` and `ownershipApplied`. A rename to anything else
   * makes a `not.toMatch` over a pattern that can no longer occur **pass
   * vacuously**, and the invariant ADR-0063 was written to protect would be
   * unguarded with a green suite.
   *
   * Replaced by a structural claim that names neither variable, plus a separate
   * identifier-existence test so a rename fails LOUDLY instead of silently
   * voiding the guard. ADR-0063 lines 137-143 already record that an
   * ordering-based safety claim survived a mutation with every test green; this
   * is the same lesson applied one level up, to the assertion itself.
   */
  test("exactly one allow exists in the guard, and it is after the evaluator", async () => {
    // The wrong implementation is one line and passes every behavioural test of
    // `evaluateAccess`, because it never reaches it:
    //     if (options?.ownershipGrant?.granted) return { allowed: true, ... }
    // That would skip ABAC, the platform-scope gate, business scope and SoD —
    // the exact four things ADR-0063 exists to preserve.
    const source = await Bun.file(GUARD_SOURCE_PATH).text();
    const body = exportedFunctionBody(source, "authorizeInTransaction");

    const allows = [...body.matchAll(/allowed:\s*true/g)];
    const evaluate = body.indexOf("evaluateAccess(");

    // Without this the index comparison below reads `> -1` and passes for ANY
    // placement — a vacuous assertion wearing the shape of a real one.
    expect(evaluate).toBeGreaterThan(-1);

    // One allow, not two: any early allow is a second match, whatever it is
    // keyed on and whatever the variable is called.
    expect(allows).toHaveLength(1);
    expect(allows[0]!.index).toBeGreaterThan(evaluate);
  });

  test("the widening is a set union computed before the evaluator", async () => {
    const source = await Bun.file(GUARD_SOURCE_PATH).text();
    const body = exportedFunctionBody(source, "authorizeInTransaction");

    // Identifier-existence, paired with the structural test above: if ADR-0063's
    // mechanism is ever renamed, THIS fails with a clear message rather than
    // leaving the structural test guarding a mechanism that no longer exists
    // under that name.
    expect(body).toContain("ownershipGrant");
    expect(body).toContain("ownershipApplied");

    // Machine credentials are excluded from the widening (ADR-0049 §3), and the
    // grant is folded into the key set BEFORE `evaluateAccess` runs.
    expect(body).toMatch(/ownershipApplied[\s\S]{0,200}?new Set\(/);
    expect(body.indexOf("ownershipApplied")).toBeLessThan(
      body.indexOf("evaluateAccess(")
    );
  });
});

describe("the live route tree", () => {
  test("access:chokepoint:check passes as committed", () => {
    const result = Bun.spawnSync(["bun", "scripts/access-chokepoint-check.ts"]);

    expect(result.exitCode).toBe(0);
  });
});

/**
 * The screen root — issue #450 / PROJECT_STATE §4 R3.
 *
 * The two roots share one script on purpose (two scripts means two exemption
 * lists, and the second one always drifts lenient), so what has to be pinned is
 * the two places they DIFFER: how a file is sliced, and what counts as
 * deciding. Both directions of the migration ledger are planted here, because a
 * one-way list that may rot is not one-way.
 */
describe("admin screens go through the chokepoint too (#450)", () => {
  const LEGACY_SCREEN = `---
const ssr = Astro.locals.ssrContext!;
const canRead = ssr.permissions.has(permissionKey("form_drafts", "draft", "read"));
---
<p>{canRead}</p>`;

  const MIGRATED_SCREEN = `---
const screen = await loadAdminScreen({
  ssr,
  workClass: "interactive",
  authorize: { moduleKey: "form_drafts", activityCode: "draft", action: "read" },
  load: async ({ tx }) => listFormDrafts(tx, ssr.tenantId, {}),
  onError: () => {}
});
---
<p>ok</p>`;

  test("a screen reading the raw grant set is deciding a permission", () => {
    const slice = sliceScreen("users.astro", LEGACY_SCREEN);

    expect(slice.id).toBe("users.astro");
    expect(slice.decidesPermissions).toBe(true);
    expect(slice.usesChokepoint).toBe(false);
  });

  test("`loadAdminScreen` covers the file, the way `defineTenantRoute` does", () => {
    const slice = sliceScreen("form-drafts.astro", MIGRATED_SCREEN);

    expect(slice.decidesPermissions).toBe(false);
    expect(slice.usesChokepoint).toBe(true);
  });

  test("a screen that reads the grant set for an affordance is a finding, even when routed", () => {
    // This asserted the OPPOSITE while the migration ledger had entries, on the
    // reasoning that the file-wide rule is the one `defineTenantRoute` gets and
    // the entry decision is what R3 is about. That was right for a half-migrated
    // screen and wrong the moment the last one landed: it let a routed screen
    // decide an AFFORDANCE from raw RBAC with the gate green.
    //
    // It was found by mutation, not by reading — planting exactly this hybrid
    // into `users.astro` left `access:chokepoint:check` at exit 0 while its own
    // summary line said "1 still decide outside the chokepoint".
    //
    // Routes keep the file-wide allowance; screens do not. `.astro` is one
    // render path per file, so there is no sibling handler for the coverage to
    // legitimately extend to.
    const slice = sliceScreen(
      "hybrid.astro",
      `${MIGRATED_SCREEN}\nconst extra = ssr.permissions.has("x");`
    );

    expect(slice.decidesPermissions).toBe(true);
    expect(slice.usesChokepoint).toBe(true);
    expect(findChokepointBypasses([slice], {}, [])).toHaveLength(1);
  });

  test("a ROUTE that decides in one handler is still covered file-wide by the factory", () => {
    // The other half of the asymmetry above, pinned so the screen tightening
    // cannot be generalised to routes by someone tidying the filter.
    // `defineTenantRoute` wraps at module level and calls the chokepoint itself.
    const route = {
      id: "thing/index.ts#GET",
      decidesPermissions: true,
      usesChokepoint: true
    };

    expect(findChokepointBypasses([route], {}, [])).toEqual([]);
  });

  test("the signal is not matched inside a comment", () => {
    // The exact false positive this gate produced on its first run against the
    // screen root: a migrated page explaining that it no longer uses
    // `ssr.permissions.has()` matched the sentence saying so.
    const slice = sliceScreen(
      "form-drafts.astro",
      `---
// the decision is the chokepoint's, not ssr.permissions.has()
/* also not ssr.permissions.has() */
${MIGRATED_SCREEN.slice(4)}`
    );

    expect(slice.decidesPermissions).toBe(false);
  });

  test("a screen finding names the SCREEN mechanism, not the route one", () => {
    const [problem] = findChokepointBypasses(
      [sliceScreen("users.astro", LEGACY_SCREEN)],
      {},
      []
    );

    expect(problem!.message).toContain("loadAdminScreen");
    expect(problem!.message).not.toContain("defineTenantRoute");
  });

  test("a ledger entry excuses a bypass — and only while it bypasses", () => {
    const slice = sliceScreen("users.astro", LEGACY_SCREEN);

    expect(findChokepointBypasses([slice], {}, ["users.astro"])).toEqual([]);
    expect(findStaleLedgerEntries([slice], ["users.astro"])).toEqual([]);
  });

  test("a migrated screen left on the ledger is a finding", () => {
    const problems = findStaleLedgerEntries(
      [sliceScreen("form-drafts.astro", MIGRATED_SCREEN)],
      ["form-drafts.astro"]
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toContain("only ever shrinks");
  });

  test("a ledger entry for a screen that no longer exists is a finding", () => {
    const problems = findStaleLedgerEntries([], ["deleted.astro"]);

    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toContain("no longer exists");
  });

  test("the ledger is exactly the set of screens still bypassing", async () => {
    // The screen-side self-test, and deliberately NOT a snapshot of two counts:
    // a number pinned here would have to be edited by every migration PR, which
    // trains the next author to edit it rather than read it. What is asserted
    // is the identity that must hold at every point in the migration — the
    // ledger names all and only the screens that still bypass — plus the
    // liveness check that the detector still finds anything at all.
    const files = await Array.fromAsync(
      new Bun.Glob("**/*.astro").scan({ cwd: "src/pages/admin" })
    );
    const slices = await Promise.all(
      files.map(async (file) =>
        sliceScreen(file, await Bun.file(`src/pages/admin/${file}`).text())
      )
    );

    const bypassing = slices
      .filter((slice) => slice.decidesPermissions && !slice.usesChokepoint)
      .map((slice) => slice.id)
      .sort();

    expect(bypassing).toEqual([...ADMIN_SCREEN_CHOKEPOINT_MIGRATION].sort());
    // At least one screen went through: the mechanism is proven, not provided.
    expect(slices.some((slice) => slice.usesChokepoint)).toBe(true);
  });

  test("the ledger is EMPTY — R3 is closed, and closed is a thing to assert", () => {
    // While the ledger had entries, "may only shrink" was enforced by the
    // staleness check: an entry whose screen no longer bypassed was a finding.
    // At zero that alarm has nothing to fire on, so growth back from zero would
    // be silent. This asserts the end state directly.
    //
    // Adding a line here is not a merge conflict to resolve — it means a new
    // admin screen decides access outside `authorizeInTransaction`, which is
    // the entire defect #450 existed to remove.
    expect([...ADMIN_SCREEN_CHOKEPOINT_MIGRATION]).toEqual([]);
  });

  test("every admin screen is routed, not merely absent from the ledger", () => {
    // The pair that makes the assertion above mean something. An empty
    // `bypassing` set is also what a BROKEN detector produces — `sliceScreen`
    // returning `decidesPermissions: false` for everything reads identically to
    // total success. The detector's own behaviour is pinned by the
    // `LEGACY_SCREEN` cases at the top of this block; this one pins the corpus:
    // all 32 screens actually call the helper.
    return Array.fromAsync(
      new Bun.Glob("**/*.astro").scan({ cwd: "src/pages/admin" })
    ).then(async (files) => {
      expect(files.length).toBeGreaterThan(0);

      const unrouted: string[] = [];

      for (const file of files) {
        const source = await Bun.file(`src/pages/admin/${file}`).text();
        if (!sliceScreen(file, source).usesChokepoint) unrouted.push(file);
      }

      expect(unrouted).toEqual([]);
    });
  });
});
