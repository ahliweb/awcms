import { describe, expect, test } from "bun:test";

import {
  collectGuardTriples,
  collectStringConstants,
  evaluateEnforcementCoverage,
  permissionTripleKey
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
 *
 * A scanner that answers "unenforced" for enforced permissions is worse than
 * no scanner: it trains its readers to add exceptions until the gate asks
 * nothing at all. Each case below is one of those drafts, frozen.
 */

function guard(
  moduleKey: string,
  activityCode: string,
  action: string
): string {
  return permissionTripleKey({ moduleKey, activityCode, action });
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
});
