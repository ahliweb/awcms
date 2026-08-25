import { describe, expect, test } from "bun:test";

import {
  collectGuardTriples,
  collectStringConstants,
  evaluateEnforcementCoverage,
  permissionTripleKey,
  resolveConstantsForSource
} from "../src/modules/_shared/permission-enforcement-coverage";
import type { ModuleDescriptor } from "../src/modules/_shared/module-contract";

/**
 * ADR-0057 §F. These tests are not about the happy path — they are the record
 * of what the first three drafts of this scanner got WRONG, each of which
 * reported permissions as unenforced while the routes gated every request.
 *
 * Draft 1 read string literals only and produced 39 false positives.
 * Draft 2 matched innermost braces and missed every guard with a nested field.
 * Draft 3 required a literal action and missed both conditional guards.
 * Draft 4 — the one that SHIPPED — read every file's constants as one flat
 * namespace, so a name bound to different values in different files became
 * unresolvable in all of them.
 *
 * A scanner that answers "unenforced" for enforced permissions is worse than
 * no scanner: it trains its readers to add exceptions until the gate asks
 * nothing at all. Each case below is one of those drafts, frozen. Draft 4 is
 * the proof that the warning was not hypothetical: it was written in this
 * file's own header, and two exceptions were recorded on its strength anyway.
 */

function guard(
  moduleKey: string,
  activityCode: string,
  action: string
): string {
  return permissionTripleKey({ moduleKey, activityCode, action });
}

/** Sorted, de-duplicated permission keys a source builds guards for. */
function distinctKeys(source: string): string[] {
  return [
    ...new Set(collectGuardTriples(source).map(permissionTripleKey))
  ].sort();
}

function moduleWith(
  key: string,
  permissions: { activityCode: string; action: string }[]
): ModuleDescriptor {
  return {
    key,
    permissions: permissions.map((permission) => ({
      ...permission,
      description: `${permission.activityCode} ${permission.action}`
    }))
  } as unknown as ModuleDescriptor;
}

describe("collectGuardTriples", () => {
  test("reads a plain three-literal guard", () => {
    const source = `
      const PUBLISH_GUARD = {
        moduleKey: "blog_content",
        activityCode: "pages",
        action: "publish" as const
      };
    `;

    expect(collectGuardTriples(source).map(permissionTripleKey)).toEqual([
      guard("blog_content", "pages", "publish")
    ]);
  });

  test("resolves guard fields written as imported constants (draft 1)", () => {
    // `theming`, `site_search`, `seo_distribution`, `comments` and
    // `media_library` all name their module key or activity through a
    // constant. Reading literals only reported all of them unenforced.
    const constantsSource = `
      export const THEMING_MODULE_KEY = "theming";
      export const THEMING_VERSION_ACTIVITY_CODE = "version";
    `;
    const routeSource = `
      const PUBLISH_GUARD = {
        moduleKey: THEMING_MODULE_KEY,
        activityCode: THEMING_VERSION_ACTIVITY_CODE,
        action: "publish" as const
      };
    `;

    const constants = collectStringConstants([constantsSource, routeSource]);

    expect(
      collectGuardTriples(routeSource, constants).map(permissionTripleKey)
    ).toEqual([guard("theming", "version", "publish")]);
  });

  test("leaves a constant bound to two different values unresolved rather than guessing", () => {
    const constants = collectStringConstants([
      `const ACTIVITY = "version";`,
      `const ACTIVITY = "config";`
    ]);

    expect(constants.get("ACTIVITY")).toBeNull();
    expect(
      collectGuardTriples(
        `const G = { moduleKey: "theming", activityCode: ACTIVITY, action: "publish" };`,
        constants
      )
    ).toEqual([]);
  });

  test("a file's own constant beats a cross-file collision on the same name (draft 4)", () => {
    // The shipped defect, reduced. `MODULE_KEY` is bound in five files to four
    // different values, so the cross-file table resolves it to null — and the
    // guard in `analytics/settings.ts`, whose own file binds it one line up,
    // became invisible. `visitor_analytics.settings.read` and `.update` were
    // then recorded as permissions nothing enforces.
    const analyticsSettingsRoute = `
      const MODULE_KEY = "visitor_analytics";
      const READ_GUARD = {
        moduleKey: MODULE_KEY,
        activityCode: "settings",
        action: "read" as const
      };
    `;
    const emailDispatch = `const MODULE_KEY = "email";`;
    const syncDispatch = `const MODULE_KEY = "sync_storage";`;

    const crossFile = collectStringConstants([
      analyticsSettingsRoute,
      emailDispatch,
      syncDispatch
    ]);

    // Unresolvable across the repo, and that much is correct.
    expect(crossFile.get("MODULE_KEY")).toBeNull();

    // Resolvable inside the file that binds it, which is the only scope that
    // decides what this guard means.
    const scoped = resolveConstantsForSource(analyticsSettingsRoute, crossFile);
    expect(scoped.get("MODULE_KEY")).toBe("visitor_analytics");

    expect(
      collectGuardTriples(analyticsSettingsRoute, scoped).map(
        permissionTripleKey
      )
    ).toEqual([guard("visitor_analytics", "settings", "read")]);
  });

  test("a name a file binds twice to different values stays unresolvable in that file", () => {
    // Local scope wins, but locally ambiguous is still ambiguous — resolving
    // to either value here would swap one false answer for the other.
    const source = `
      const ACTIVITY = "settings";
      const ACTIVITY = "dashboard";
      const G = { moduleKey: "visitor_analytics", activityCode: ACTIVITY, action: "read" };
    `;

    const scoped = resolveConstantsForSource(source, new Map());

    expect(scoped.get("ACTIVITY")).toBeNull();
    expect(collectGuardTriples(source, scoped)).toEqual([]);
  });

  test("an imported constant still resolves through the cross-file table", () => {
    // File-first must not mean file-only: most guards name their module key
    // through a constant that lives in another module entirely.
    const constantsSource = `export const THEMING_MODULE_KEY = "theming";`;
    const routeSource = `
      const G = {
        moduleKey: THEMING_MODULE_KEY,
        activityCode: "version",
        action: "publish"
      };
    `;

    const scoped = resolveConstantsForSource(
      routeSource,
      collectStringConstants([constantsSource, routeSource])
    );

    expect(
      collectGuardTriples(routeSource, scoped).map(permissionTripleKey)
    ).toEqual([guard("theming", "version", "publish")]);
  });

  test("reads a guard that carries a nested object (draft 2)", () => {
    // `workflows/tasks/{id}/decisions.ts`. Matching innermost braces finds
    // only `resourceAttributes` and never the guard wrapped around it.
    const source = `
      const GUARD_ACTIVITY = { moduleKey: "workflow", activityCode: "approval" };
      const guardRequest = {
        ...GUARD_ACTIVITY,
        action: "approve" as const,
        resourceType: "workflow_task",
        resourceAttributes: {
          tenantId,
          requestedByTenantUserId: task?.requested_by_tenant_user_id
        }
      };
    `;

    expect(collectGuardTriples(source).map(permissionTripleKey)).toContain(
      guard("workflow", "approval", "approve")
    );
  });

  test("reads both branches of a conditional action (draft 3)", () => {
    // `comments/admin/{id}/moderate.ts` decides the action per request; the
    // route really does gate on one of the two.
    const source = `
      const MODERATE_GUARD = {
        moduleKey: "comments",
        activityCode: "moderation",
        action: (decision === "approve" ? "approve" : "reject") as
          | "approve"
          | "reject"
      };
    `;

    const keys = collectGuardTriples(source).map(permissionTripleKey);

    expect(keys).toContain(guard("comments", "moderation", "approve"));
    expect(keys).toContain(guard("comments", "moderation", "reject"));
  });

  test("does not mistake an audit event for a guard", () => {
    // Audit events carry `moduleKey` and `action` but never `activityCode`,
    // and their action is an event name. ADR-0056 §1 records that reading
    // these as gates gives the wrong answer.
    const source = `
      await recordAuditEvent(tx, {
        tenantId,
        moduleKey: "blog_content",
        action: "blog.page.purged",
        resourceType: "blog_page"
      });
    `;

    expect(collectGuardTriples(source)).toEqual([]);
  });

  test("does not read an action out of a nested attributes object", () => {
    const source = `
      await recordAuditEvent(tx, {
        moduleKey: "theming",
        activityCode: "version",
        attributes: { action: "publish" }
      });
    `;

    expect(collectGuardTriples(source)).toEqual([]);
  });

  test("ignores guard shapes that appear in comments", () => {
    const source = `
      // const GUARD = { moduleKey: "blog_content", activityCode: "pages", action: "publish" };
      /* { moduleKey: "comments", activityCode: "moderation", action: "delete" } */
      const unrelated = 1;
    `;

    expect(collectGuardTriples(source)).toEqual([]);
  });

  test("does not mistake the string a ternary TESTS for one it yields", () => {
    // `src/pages/api/v1/seo/redirects/[id]/lifecycle.ts`, verbatim in shape.
    // The guard can require `delete` or `update`; `purge` is what the request
    // is compared against. Reading it as a third action invented
    // `seo_distribution.redirect.purge` — a permission no module declares and
    // no catalogue row backs.
    const source = `
      const guard = {
        moduleKey: "seo_distribution",
        activityCode: "redirect",
        action: (lifecycleAction === "purge" ? "delete" : "update") as
          "delete" | "update"
      };
    `;

    // Distinct keys, because the captured expression runs on to the end of the
    // `as "delete" | "update"` annotation and every action is therefore seen
    // twice. Every consumer collects into a Set, so the repetition is inert —
    // but asserting an exact array here would be pinning that accident rather
    // than the rule under test.
    expect(distinctKeys(source)).toEqual([
      "seo_distribution.redirect.delete",
      "seo_distribution.redirect.update"
    ]);
  });

  test("keeps a literal that is both tested for AND yielded", () => {
    // The comments routes: `approve` appears in the condition and again as a
    // value. Dropping the whole CONDITION rather than just the operand would
    // lose it, and report a fully enforced permission as unenforced.
    const source = `
      const guard = {
        moduleKey: "comments",
        activityCode: "moderation",
        action: (decision === "approve" ? "approve" : "reject") as
          "approve" | "reject"
      };
    `;

    expect(distinctKeys(source)).toEqual([
      "comments.moderation.approve",
      "comments.moderation.reject"
    ]);
  });

  test("removing an operand does not re-pair the quotes around it", () => {
    // Blanking `=== "purge"` to `=== ""` looks equivalent and is not: the empty
    // pair shifts which quotes match, so the GAPS between the real literals
    // (`" ? "`, `" : "`) start matching as literals themselves. That is a
    // defect this fix's own first draft shipped, so it is pinned here rather
    // than left to the shape of a regex.
    const source = `
      const guard = {
        moduleKey: "comments",
        activityCode: "moderation",
        action: (decision === "approve" ? "approve" : "reject")
      };
    `;

    for (const triple of collectGuardTriples(source)) {
      expect(triple.action).toMatch(/^[a-z_]+$/);
    }
  });
});

describe("evaluateEnforcementCoverage", () => {
  const modules = [
    moduleWith("blog_content", [
      { activityCode: "pages", action: "publish" },
      { activityCode: "posts", action: "export" }
    ])
  ];

  test("passes when every declared permission has a guard or a reason", () => {
    const result = evaluateEnforcementCoverage(
      modules,
      [
        `const G = { moduleKey: "blog_content", activityCode: "pages", action: "publish" };`
      ],
      [
        {
          key: "blog_content.posts.export",
          reason: "No endpoint; ADR pending."
        }
      ]
    );

    expect(result.valid).toBe(true);
    expect(result.enforcedCount).toBe(1);
    expect(result.declaredCount).toBe(2);
  });

  test("reports the original ADR-0057 defect: a declared permission nothing enforces", () => {
    const result = evaluateEnforcementCoverage(
      modules,
      // The state of `main` before this change — pages could be created and
      // updated, and no code path could publish one.
      [
        `const G = { moduleKey: "blog_content", activityCode: "pages", action: "update" };`
      ],
      [
        {
          key: "blog_content.posts.export",
          reason: "No endpoint; ADR pending."
        }
      ]
    );

    expect(result.valid).toBe(false);
    expect(result.unenforced.map((entry) => entry.key)).toEqual([
      "blog_content.pages.publish"
    ]);
  });

  test("scopes constants per file end-to-end, not just in the helper (draft 4)", () => {
    // The gate calls `evaluateEnforcementCoverage`, so scoping has to hold
    // HERE. Passing the flat table through was the shipped bug, and it is one
    // line — a helper that scopes correctly while its only caller does not
    // would look fixed and behave exactly as before.
    const result = evaluateEnforcementCoverage(
      [
        moduleWith("visitor_analytics", [
          { activityCode: "settings", action: "read" }
        ])
      ],
      [
        `
          const MODULE_KEY = "visitor_analytics";
          const READ_GUARD = { moduleKey: MODULE_KEY, activityCode: "settings", action: "read" };
        `,
        `const MODULE_KEY = "email";`
      ],
      []
    );

    expect(result.unenforced).toEqual([]);
    expect(result.valid).toBe(true);
  });

  test("reports an exception that has since gained an enforcer as stale", () => {
    // An exception outliving its reason is how a gate quietly stops asking.
    const result = evaluateEnforcementCoverage(
      modules,
      [
        `const A = { moduleKey: "blog_content", activityCode: "pages", action: "publish" };`,
        `const B = { moduleKey: "blog_content", activityCode: "posts", action: "export" };`
      ],
      [
        {
          key: "blog_content.posts.export",
          reason: "No endpoint; ADR pending."
        }
      ]
    );

    expect(result.valid).toBe(false);
    expect(result.staleExceptions).toEqual(["blog_content.posts.export"]);
  });

  test("reports an exception for a permission that is no longer declared as stale", () => {
    const result = evaluateEnforcementCoverage(
      modules,
      [
        `const A = { moduleKey: "blog_content", activityCode: "pages", action: "publish" };`
      ],
      [
        {
          key: "blog_content.posts.export",
          reason: "No endpoint; ADR pending."
        },
        { key: "media_library.media.attach", reason: "Revoked by ADR-0056 §A." }
      ]
    );

    expect(result.valid).toBe(false);
    expect(result.staleExceptions).toEqual(["media_library.media.attach"]);
  });

  test("reports a guard for a permission no module declares, and names the file", () => {
    // The reverse direction, and the worse of the two failures: no catalogue
    // row backs the key, so no role can hold it and every actor is denied.
    // Invisible to the forward question, which only ever iterates DECLARED
    // permissions — a key nobody declared is not in the set being walked.
    const result = evaluateEnforcementCoverage(
      modules,
      [
        `const A = { moduleKey: "blog_content", activityCode: "pages", action: "publish" };`,
        `const B = { moduleKey: "blog_content", activityCode: "pages", action: "unpublish" };`
      ],
      [
        {
          key: "blog_content.posts.export",
          reason: "No endpoint; ADR pending."
        }
      ],
      [
        "src/pages/api/v1/blog/pages/publish.ts",
        "src/pages/api/v1/blog/pages/unpublish.ts"
      ]
    );

    expect(result.valid).toBe(false);
    expect(result.undeclaredGuards).toEqual([
      {
        key: "blog_content.pages.unpublish",
        sources: ["src/pages/api/v1/blog/pages/unpublish.ts"]
      }
    ]);
    // The forward direction stays silent about it — which is the whole reason
    // the reverse one had to be added rather than assumed covered.
    expect(result.unenforced).toEqual([]);
  });

  test("collects every file that builds the same undeclared guard", () => {
    const result = evaluateEnforcementCoverage(
      modules,
      [
        `const A = { moduleKey: "blog_content", activityCode: "pages", action: "archive" };`,
        `const B = { moduleKey: "blog_content", activityCode: "pages", action: "archive" };`
      ],
      [],
      ["src/one.ts", "src/two.ts"]
    );

    expect(result.undeclaredGuards[0]?.sources).toEqual([
      "src/one.ts",
      "src/two.ts"
    ]);
  });

  test("an exception can excuse an UNDECLARED guard, and is not stale for being one", () => {
    // Staleness had one rule — "not declared" — and the reverse direction makes
    // that rule wrong: an exception excusing an undeclared guard is doing its
    // job precisely BECAUSE the permission is undeclared. Left alone, it would
    // have been impossible to write such an exception at all: recording one
    // would immediately report it stale.
    const result = evaluateEnforcementCoverage(
      modules,
      [
        `const A = { moduleKey: "blog_content", activityCode: "pages", action: "publish" };`,
        `const B = { moduleKey: "blog_content", activityCode: "pages", action: "unpublish" };`
      ],
      [
        {
          key: "blog_content.posts.export",
          reason: "No endpoint; ADR pending."
        },
        {
          key: "blog_content.pages.unpublish",
          reason: "Guarded ahead of its seed migration; ADR-XXXX."
        }
      ],
      ["src/a.ts", "src/b.ts"]
    );

    expect(result.undeclaredGuards).toEqual([]);
    expect(result.staleExceptions).toEqual([]);
    expect(result.valid).toBe(true);
  });

  test("the source list is optional, and its absence costs only the file name", () => {
    // Callers that scan text they built themselves pass no paths. The finding
    // must still be reported — a gate that needs a filename to notice a defect
    // would be a gate with an off switch.
    const result = evaluateEnforcementCoverage(
      modules,
      [
        `const B = { moduleKey: "blog_content", activityCode: "pages", action: "unpublish" };`
      ],
      [
        {
          key: "blog_content.posts.export",
          reason: "No endpoint; ADR pending."
        },
        { key: "blog_content.pages.publish", reason: "Not yet built." }
      ]
    );

    expect(result.valid).toBe(false);
    expect(result.undeclaredGuards).toEqual([
      { key: "blog_content.pages.unpublish", sources: [] }
    ]);
  });
});
