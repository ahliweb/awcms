/**
 * `/admin/crm-follow-up`, `/admin/crm-follow-up/[id]` and
 * `/admin/crm-follow-up/rules` gate against the endpoints they drive (Issue
 * #1165, ADR-0159).
 *
 * Sibling of the other page-contract tests, for the same silent failure: a page
 * gating on a permission key no migration seeds hides the control from EVERYONE,
 * the owner included, while still looking like a working screen. The properties
 * pinned here are the ones the issue makes load-bearing:
 *
 * - every permission the screens name is DECLARED, SEEDED and ENFORCED by the
 *   endpoint behind the control, and the navigation entries open pages that
 *   exist on keys the pages accept;
 * - the screens read through the module's loaders, which call the routes' OWN
 *   directory functions, so tenant isolation and the filters are the API's;
 * - nothing about the prospect is rendered: no name, address or message text;
 * - every mutation the scripts send carries an `Idempotency-Key` (and the task
 *   writes an `expectedVersion`), and the action with no endpoint is DISABLED;
 * - the scripts are bundled (they import a module, so CSP allows them).
 *
 * Pure: no database, no network. The isolation and control properties are
 * measured against a real database in
 * `tests/integration/crm-follow-up-screens.integration.test.ts`.
 */
import { readFileSync } from "node:fs";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";
import { stripComments } from "../scripts/lib/source-text";
import { CRM_FOLLOW_UP_GUARDS } from "../src/modules/crm-follow-up/domain/crm-follow-up-constants";

const LIST_PAGE = "src/pages/admin/crm-follow-up.astro";
const DETAIL_PAGE = "src/pages/admin/crm-follow-up/[id].astro";
const RULES_PAGE = "src/pages/admin/crm-follow-up/rules.astro";
/** Comments stripped: the docblocks name the very things the screens must not do. */
const read = (path: string) => stripComments(readFileSync(path, "utf8"));
const list = read(LIST_PAGE);
const detail = read(DETAIL_PAGE);
const rules = read(RULES_PAGE);
/** The chain the pages delegate to; its BEHAVIOUR is the integration test's. */
const loaders = read("src/modules/crm-follow-up/application/screen-loaders.ts");

/** The literal guard a page spells out, so the coverage gate (which reads source text) sees it. */
function literalGuard(source: string, name: string) {
  const match = new RegExp(
    `const ${name} = \\{\\s*moduleKey: "([a-z_]+)",\\s*activityCode: "([a-z_]+)",\\s*action: "([a-z_]+)"\\s*\\} as const;`
  ).exec(source);

  expect(match).not.toBeNull();

  return { moduleKey: match![1], activityCode: match![2], action: match![3] };
}

describe("the screens gate on keys that really exist", () => {
  const G = CRM_FOLLOW_UP_GUARDS;

  test("each literal guard equals the module's own guard constant", () => {
    expect(literalGuard(list, "READ_GUARD")).toEqual(G.readTasks);
    expect(literalGuard(list, "RULES_READ_GUARD")).toEqual(G.readRules);
    expect(literalGuard(detail, "READ_GUARD")).toEqual(G.readTasks);
    expect(literalGuard(detail, "UPDATE_GUARD")).toEqual(G.updateTasks);
    expect(literalGuard(detail, "STOP_GUARD")).toEqual(G.createStopSignals);
    expect(literalGuard(rules, "READ_GUARD")).toEqual(G.readRules);
    expect(literalGuard(rules, "CONFIGURE_GUARD")).toEqual(G.configureRules);
  });

  test("every key is DECLARED by the module and SEEDED by the migration", () => {
    const module = listModules().find((m) => m.key === "crm_follow_up")!;
    const declared = new Set(
      (module.permissions ?? []).map(
        (permission) =>
          `${module.key}.${permission.activityCode}.${permission.action}`
      )
    );
    const seed = read("sql/370_awcms_crm_follow_up_permissions.sql");

    for (const guard of Object.values(G)) {
      expect(
        declared.has(`${guard.moduleKey}.${guard.activityCode}.${guard.action}`)
      ).toBe(true);
      expect(seed).toContain(
        `'${guard.moduleKey}', '${guard.activityCode}', '${guard.action}'`
      );
    }
  });

  test("each endpoint enforces the key the screen assumes", () => {
    const base = "src/pages/api/v1/crm-follow-up";
    const expectations: [string, string][] = [
      [`${base}/tasks/index.ts`, "CRM_FOLLOW_UP_GUARDS.readTasks"],
      [`${base}/tasks/[id]/index.ts`, "CRM_FOLLOW_UP_GUARDS.readTasks"],
      [`${base}/tasks/[id]/complete.ts`, "CRM_FOLLOW_UP_GUARDS.updateTasks"],
      [`${base}/tasks/[id]/cancel.ts`, "CRM_FOLLOW_UP_GUARDS.updateTasks"],
      [
        `${base}/leads/[leadId]/stop-signals.ts`,
        "CRM_FOLLOW_UP_GUARDS.readTasks"
      ],
      [
        `${base}/leads/[leadId]/stop-signals.ts`,
        "CRM_FOLLOW_UP_GUARDS.createStopSignals"
      ],
      [`${base}/rules/index.ts`, "CRM_FOLLOW_UP_GUARDS.readRules"],
      [`${base}/rules/[id]/index.ts`, "CRM_FOLLOW_UP_GUARDS.readRules"],
      [`${base}/settings.ts`, "CRM_FOLLOW_UP_GUARDS.readRules"],
      [`${base}/settings.ts`, "CRM_FOLLOW_UP_GUARDS.configureRules"]
    ];

    for (const [route, guard] of expectations) {
      expect(read(route)).toContain(guard);
    }
  });

  test("the sidebar entries open pages that exist, on the key each page accepts", () => {
    const module = listModules().find((m) => m.key === "crm_follow_up")!;

    expect(module.status).toBe("active");
    expect(module.navigation).toEqual([
      expect.objectContaining({
        path: "/admin/crm-follow-up",
        requiredPermission: "crm_follow_up.tasks.read"
      }),
      expect.objectContaining({
        path: "/admin/crm-follow-up/rules",
        requiredPermission: "crm_follow_up.rules.read"
      })
    ]);
    expect(list).toContain("authorize: READ_GUARD");
    expect(detail).toContain("authorize: READ_GUARD");
    expect(rules).toContain("authorize: READ_GUARD");
  });

  test("a control is shown only when the chokepoint allows its permission", () => {
    expect(detail).toContain("updateGuard: UPDATE_GUARD");
    expect(detail).toContain("stopGuard: STOP_GUARD");
    expect(rules).toContain("configureGuard: CONFIGURE_GUARD");
    expect(list).toContain("rulesReadGuard: RULES_READ_GUARD");
    expect(loaders).toContain("await can(input.updateGuard)");
    expect(loaders).toContain("await can(input.stopGuard)");
    expect(loaders).toContain("await can(input.configureGuard)");
    expect(loaders).toContain("await can(input.rulesReadGuard)");

    for (const source of [list, detail, rules, loaders]) {
      // Never raw RBAC: that skips ABAC and module state.
      expect(source).not.toContain("ssr.permissions.has");
    }
  });

  test("the screens are off with the deployment switch, checked AFTER authorization", () => {
    // The switch lives in the loaders, which run only inside `loadAdminScreen`'s
    // `load` (after it allowed the page); the pages hold no read that could skip it.
    for (const source of [list, detail, rules]) {
      expect(source).not.toContain("isCrmFollowUpEnabled");
      expect(
        source.search(/\bload(Worklist|TaskDetail|Rules)\(/)
      ).toBeGreaterThan(source.indexOf("await loadAdminScreen("));
    }

    expect(loaders.match(/if \(!isCrmFollowUpEnabled\(\)\)/g)).toHaveLength(3);
  });
});

describe("the screens read through the routes' own rules", () => {
  test("listing is the API's directory function, with no SQL in the page", () => {
    for (const source of [list, detail, rules]) {
      expect(source).not.toMatch(
        /listTasks|fetchTaskDetail|listStopSignals|listRules|fetchRuleWithRevisions/
      );
      expect(source).not.toMatch(/\btx`/);
      expect(source).not.toContain("awcms_crm_follow_up_");
    }

    expect(loaders).toContain("listTasks(");
    expect(loaders).toContain("fetchTaskDetail(");
    expect(loaders).toContain("listStopSignals(");
    expect(loaders).toContain("listRules(");
    expect(loaders).toContain("fetchRuleWithRevisions(");
  });

  test("the list turns the URL into the API's own typed query and filters in SQL", () => {
    expect(loaders).toContain("validateTaskListQuery(");
    expect(loaders).toContain('params.set("overdue", "true")');
    expect(loaders).toContain('params.set("assignee", "me")');
    // The query is parsed BEFORE the load that needs it, and the load is bounded.
    expect(list.indexOf("parseDataPageQuery(")).toBeLessThan(
      list.indexOf("await loadAdminScreen(")
    );
    expect(loaders).toContain("LOAD_PAGE_LIMIT = 2");
  });

  test("the daily worklist is the viewer's own id, never one from the URL", () => {
    // `assignee=me` is resolved from the authorized session inside the
    // directory; the loader passes the session's person, not a URL value.
    expect(loaders).toContain("context.auth.context.tenantUserId");
    expect(loaders).not.toMatch(/filters\.assignee,?\s*\n?\s*validated/);
  });

  test("an unknown or foreign id is one 'not found' answer", () => {
    expect(detail).toContain("crm-follow-up-task-not-found");
    expect(detail).toContain("asUuid(Astro.params.id)");
    expect(rules).toContain("crm-follow-up-rule-not-found");
  });
});

describe("nothing about the prospect is rendered", () => {
  test("the screens name no name, address, phone or message text", () => {
    for (const source of [list, detail, rules]) {
      expect(source).not.toMatch(/displayName|contactPoint|contact_point/i);
      expect(source).not.toMatch(/\bemail\b|\bphone\b|\baddress\b/i);
      expect(source).not.toMatch(/messageBody|\bbody\b.*lead/i);
    }
  });

  test("a staff member is 'you' or 'another staff member', never resolved to a name", () => {
    for (const source of [list, detail, rules]) {
      expect(source).toContain('t("Another staff member")');
      expect(source).not.toContain("assigneeTenantUserId}");
      expect(source).not.toContain("actorTenantUserId}");
      expect(source).not.toContain("recipientTenantUserId}");
    }
  });

  test("the module sends nothing to the lead: there is no send control", () => {
    for (const source of [list, detail, rules]) {
      expect(source).not.toMatch(/send(Message|Reply)|\/send\b/);
      expect(source).not.toContain('<textarea name="reply"');
    }
  });
});

describe("the actions", () => {
  const script = detail.slice(detail.indexOf("<script>"));

  test("every task write carries expectedVersion and every write an Idempotency-Key", () => {
    expect(script).toContain('"Idempotency-Key"');
    expect(script).toContain("/complete`");
    expect(script).toContain("/cancel`");
    expect(script).toContain("/stop-signals`");
    expect(script.match(/expectedVersion/g)?.length).toBeGreaterThanOrEqual(2);
    expect(script).toContain("VERSION_CONFLICT");
    expect(script).toContain("CRM_FOLLOW_UP_TENANT_DISABLED");
  });

  test("the tenant switch carries an Idempotency-Key and a confirmation", () => {
    const rulesScript = rules.slice(rules.indexOf("<script>"));

    expect(rulesScript).toContain("/settings`");
    expect(rulesScript).toContain('"Idempotency-Key"');
    expect(rulesScript).toContain("confirmAction(");
    expect(rulesScript).toContain("switchBody(");
  });

  test("the irreversible actions are confirmed, and nothing is stored in the browser", () => {
    expect(script.match(/confirmAction\(/g)?.length).toBeGreaterThanOrEqual(2);

    for (const source of [script, rules.slice(rules.indexOf("<script>"))]) {
      expect(source).not.toContain("localStorage");
      expect(source).not.toContain("sessionStorage");
    }
  });

  test("'reassign' has no endpoint behind it and is DISABLED with its reason", () => {
    expect(detail).toMatch(
      /<button[^>]*\sdisabled\s[^>]*aria-describedby="crm-follow-up-reassign-why"/
    );
    expect(detail).toContain('id="crm-follow-up-reassign-why"');
    // No control posts an arbitrary assignee id.
    expect(detail).not.toMatch(/name="assignee/);
  });

  test("a closed task, or a tenant with follow-up off, disables the writes", () => {
    expect(detail).toContain("LIVE_TASK_STATUSES");
    expect(detail).toContain("disabled={!writable}");
    expect(detail).toContain("disabled={!detail.tenantEnabled}");
  });

  test("scripts import a module, so Astro bundles them under the CSP", () => {
    for (const source of [detail, rules]) {
      const tail = source.slice(source.indexOf("<script>"));

      expect(tail).toContain('from "../../../lib/ui/admin-form-client"');
    }
  });

  test("the rule editor has no form here: rules are read-only on this screen", () => {
    // The script sends only the switch; no rule write is reachable.
    const rulesScript = rules.slice(rules.indexOf("<script>"));

    expect(rulesScript).not.toContain("/rules");
    expect(rulesScript).not.toContain("/revisions");
    expect(rulesScript).not.toContain("/archive");
    expect(rules).not.toContain("<form");
  });
});

describe("the screens are ADR-0149 data pages", () => {
  test("the list uses the four shared primitives and the URL contract", () => {
    for (const component of [
      "DataListToolbar",
      "DataEmptyState",
      "SortableHeader",
      "KeysetPager"
    ]) {
      expect(list).toContain(`<${component}`);
    }

    expect(list).toContain("sliceKeyset(");
    expect(list).toContain('role="region"');
    expect(list).toContain('tabindex="0"');
  });

  test("the list's total is only shown when it is exact", () => {
    expect(list).toContain("total={data.more ? undefined : page.total}");
  });
});
