/**
 * `/admin/omnichannel-inbox`, `/admin/omnichannel-inbox/[id]` and
 * `/admin/omnichannel-inbox/settings` gate against the endpoints they drive
 * (Issue #1164, ADR-0160, UP-14).
 *
 * Sibling of the other page-contract tests, for the same silent failure: a page
 * gating on a permission key no migration seeds hides the control from EVERYONE,
 * the owner included, while still looking like a working screen. The properties
 * pinned here are the ones the issue makes load-bearing:
 *
 * - every permission the screens name is DECLARED, SEEDED and ENFORCED by the
 *   endpoint behind the control, and the navigation entry opens a page that
 *   exists on a key the page accepts;
 * - the screens read through the ROUTES' OWN functions (`visibilityFor`,
 *   `listConversations`, `getConversation`, `listSlaPolicies`), so business-scope
 *   confinement and tenant isolation are the API's, not a copy;
 * - NO message body, name, address or Telegram id is ever rendered or selected;
 * - every mutation the scripts send carries `expectedVersion` or an
 *   `Idempotency-Key`, and the action with no endpoint is shown DISABLED;
 * - the scripts are bundled (they import a module, so CSP allows them).
 *
 * Pure: no database, no network. The isolation properties themselves are
 * measured against a real database in
 * `tests/integration/omnichannel-inbox.integration.test.ts`.
 */
import { readFileSync } from "node:fs";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";
import { stripComments } from "../scripts/lib/source-text";
import { OMNICHANNEL_INBOX_GUARDS } from "../src/modules/omnichannel-inbox/domain/inbox-constants";

const LIST_PAGE = "src/pages/admin/omnichannel-inbox.astro";
const DETAIL_PAGE = "src/pages/admin/omnichannel-inbox/[id].astro";
const SETTINGS_PAGE = "src/pages/admin/omnichannel-inbox/settings.astro";
/** Comments stripped: the docblocks name the very things the screens must not do. */
const read = (path: string) => stripComments(readFileSync(path, "utf8"));
const list = read(LIST_PAGE);
const detail = read(DETAIL_PAGE);
const settings = read(SETTINGS_PAGE);
/** The chain the pages delegate to; its BEHAVIOUR is the integration test's (`omnichannel-inbox-screens.integration.test.ts`). */
const loaders = read(
  "src/modules/omnichannel-inbox/application/screen-loaders.ts"
);

/** The literal guard object a page spells out, so the coverage gate (which reads source text) sees it. */
function literalGuard(source: string, name: string) {
  const match = new RegExp(
    `const ${name} = \\{\\s*moduleKey: "([a-z_]+)",\\s*activityCode: "([a-z_]+)",\\s*action: "([a-z_]+)"\\s*\\} as const;`
  ).exec(source);

  expect(match).not.toBeNull();

  return { moduleKey: match![1], activityCode: match![2], action: match![3] };
}

describe("the screens gate on keys that really exist", () => {
  const G = OMNICHANNEL_INBOX_GUARDS;

  test("each literal guard equals the module's own guard constant", () => {
    expect(literalGuard(list, "READ_GUARD")).toEqual(G.readConversations);
    expect(literalGuard(list, "SLA_READ_GUARD")).toEqual(G.readSlaPolicies);
    expect(literalGuard(detail, "READ_GUARD")).toEqual(G.readConversations);
    expect(literalGuard(detail, "UPDATE_GUARD")).toEqual(G.updateConversations);
    expect(literalGuard(detail, "ASSIGN_GUARD")).toEqual(G.assignConversations);
    expect(literalGuard(settings, "SLA_READ_GUARD")).toEqual(G.readSlaPolicies);
    expect(literalGuard(settings, "SLA_CONFIGURE_GUARD")).toEqual(
      G.configureSlaPolicies
    );
    expect(literalGuard(settings, "CONVERSATIONS_READ_GUARD")).toEqual(
      G.readConversations
    );
    expect(literalGuard(settings, "TAGS_CONFIGURE_GUARD")).toEqual(
      G.configureTags
    );
    expect(literalGuard(settings, "PROJECTION_CONFIGURE_GUARD")).toEqual(
      G.configureProjection
    );
  });

  test("every key is DECLARED by the module and SEEDED by the migration", () => {
    const module = listModules().find((m) => m.key === "omnichannel_inbox")!;
    const declared = new Set(
      (module.permissions ?? []).map(
        (permission) =>
          `${module.key}.${permission.activityCode}.${permission.action}`
      )
    );
    const seed = read("sql/383_awcms_omnichannel_inbox_permissions.sql");

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
    const base = "src/pages/api/v1/omnichannel-inbox";
    const expectations: [string, string][] = [
      [
        `${base}/conversations/index.ts`,
        "OMNICHANNEL_INBOX_GUARDS.readConversations"
      ],
      [
        `${base}/conversations/[id]/index.ts`,
        "OMNICHANNEL_INBOX_GUARDS.readConversations"
      ],
      [
        `${base}/conversations/[id]/status.ts`,
        "OMNICHANNEL_INBOX_GUARDS.updateConversations"
      ],
      [
        `${base}/conversations/[id]/tags.ts`,
        "OMNICHANNEL_INBOX_GUARDS.updateConversations"
      ],
      [
        `${base}/conversations/[id]/responses.ts`,
        "OMNICHANNEL_INBOX_GUARDS.updateConversations"
      ],
      [
        `${base}/conversations/[id]/assignment.ts`,
        "OMNICHANNEL_INBOX_GUARDS.assignConversations"
      ],
      [`${base}/tags/index.ts`, "OMNICHANNEL_INBOX_GUARDS.configureTags"],
      [`${base}/tags/[id].ts`, "OMNICHANNEL_INBOX_GUARDS.configureTags"],
      [
        `${base}/sla-policies/index.ts`,
        "OMNICHANNEL_INBOX_GUARDS.readSlaPolicies"
      ],
      [
        `${base}/sla-policies/index.ts`,
        "OMNICHANNEL_INBOX_GUARDS.configureSlaPolicies"
      ],
      [
        `${base}/sla-policies/[id]/retire.ts`,
        "OMNICHANNEL_INBOX_GUARDS.configureSlaPolicies"
      ],
      [
        `${base}/projection/rebuild.ts`,
        "OMNICHANNEL_INBOX_GUARDS.configureProjection"
      ]
    ];

    for (const [route, guard] of expectations) {
      expect(read(route)).toContain(guard);
    }
  });

  test("the sidebar entry opens the list page on the key the page accepts", () => {
    const module = listModules().find((m) => m.key === "omnichannel_inbox")!;

    expect(module.status).toBe("active");
    expect(module.navigation).toEqual([
      expect.objectContaining({
        path: "/admin/omnichannel-inbox",
        requiredPermission: "omnichannel_inbox.conversations.read"
      }),
      expect.objectContaining({
        path: "/admin/omnichannel-inbox/settings",
        requiredPermission: "omnichannel_inbox.sla_policies.read"
      })
    ]);
    expect(list).toContain("authorize: READ_GUARD");
    expect(detail).toContain("authorize: READ_GUARD");
    expect(settings).toContain("authorize: SLA_READ_GUARD");
  });

  test("a control is shown only when the chokepoint allows its permission", () => {
    // The pages hand their own literal guards to the loaders (so the coverage
    // gate sees them); the loaders ask the chokepoint with exactly those.
    expect(detail).toContain("updateGuard: UPDATE_GUARD");
    expect(detail).toContain("assignGuard: ASSIGN_GUARD");
    expect(settings).toContain("slaConfigureGuard: SLA_CONFIGURE_GUARD");
    expect(settings).toContain("tagsConfigureGuard: TAGS_CONFIGURE_GUARD");
    expect(settings).toContain(
      "projectionConfigureGuard: PROJECTION_CONFIGURE_GUARD"
    );
    // The tag catalogue is `conversations.read` on its endpoint.
    expect(settings).toContain(
      "conversationsReadGuard: CONVERSATIONS_READ_GUARD"
    );
    expect(loaders).toContain("await can(input.updateGuard)");
    expect(loaders).toContain("await can(input.assignGuard)");
    expect(loaders).toContain("await can(input.slaConfigureGuard)");
    expect(loaders).toContain("await can(input.tagsConfigureGuard)");
    expect(loaders).toContain("await can(input.projectionConfigureGuard)");
    expect(loaders).toContain("await can(input.conversationsReadGuard)");

    for (const source of [list, detail, settings, loaders]) {
      // Never raw RBAC: that skips ABAC and module state.
      expect(source).not.toContain("ssr.permissions.has");
    }
  });

  test("the screens are off with the deployment switch, checked AFTER authorization", () => {
    // The switch lives in the loaders, which run only inside `loadAdminScreen`'s
    // `load` (after it allowed the page); the pages hold no read that could skip it.
    for (const source of [list, detail, settings]) {
      expect(source).not.toContain("isOmnichannelInboxEnabled");
      expect(source.search(/\bloadInbox\w+\(/)).toBeGreaterThan(
        source.indexOf("await loadAdminScreen(")
      );
    }

    expect(
      loaders.match(/if \(!isOmnichannelInboxEnabled\(\)\)/g)
    ).toHaveLength(3);
  });
});

describe("the screens read through the routes' own rules", () => {
  test("visibility and listing are the API's functions, with no SQL in the page", () => {
    // The pages name neither the visibility rule nor a directory function: the
    // chain is the loaders', and a page that re-inlined it (and could widen the
    // argument) would redden here and in the behavioural integration test.
    for (const source of [list, detail, settings]) {
      expect(source).not.toMatch(
        /visibilityFor|listConversations|getConversation|listSlaPolicies|unconfined/
      );
    }

    expect(list).toContain("readGuard: READ_GUARD");
    expect(detail).toContain("readGuard: READ_GUARD");
    expect(settings).toContain("slaReadGuard: SLA_READ_GUARD");
    expect(loaders).toContain("visibilityFor(context, readGuard)");
    expect(loaders).toContain("visibilityFor(context, input.slaReadGuard)");
    expect(loaders).toContain("listConversations(");
    expect(loaders).toContain("getConversation(");
    expect(loaders).toContain("listSlaPolicies(");

    for (const source of [list, detail, settings]) {
      expect(source).not.toMatch(/\btx`/);
      expect(source).not.toContain("awcms_inbox_");
    }
  });

  test("the list turns the URL into the API's own typed query and filters in SQL", () => {
    expect(loaders).toContain("validateListConversationsQuery(");
    expect(loaders).toContain('params.set("slaState", "breached")');
    expect(loaders).toContain('params.set("tagId", tag)');
    // The query is parsed BEFORE the load that needs it, and the load is bounded.
    expect(list.indexOf("parseDataPageQuery(")).toBeLessThan(
      list.indexOf("await loadAdminScreen(")
    );
    expect(loaders).toContain("LOAD_PAGE_LIMIT = 2");
  });

  test("an unknown or foreign id is one 'not found' answer", () => {
    expect(detail).toContain("omnichannel-conversation-not-found");
    expect(detail).toContain("asUuid(Astro.params.id)");
  });
});

describe("the rebuild button", () => {
  test("continues from where the last click stopped instead of replaying from zero", () => {
    expect(settings).toContain("let rebuildAfter =");
    expect(settings).toContain("let after = rebuildAfter;");
    expect(settings).toContain("rebuildResumePoint(complete,");
    expect(settings).not.toMatch(/let after = "0"/);
  });
});

describe("no message body or customer identifier is rendered or selected", () => {
  test("the screens name no body, address, name or Telegram id", () => {
    for (const source of [list, detail, settings]) {
      expect(source).not.toMatch(/\bbody\b.*conversation/i);
      expect(source).not.toMatch(
        /chat_?id|telegram_?user|username|first_?name/i
      );
      expect(source).not.toMatch(/\bemail\b|\bphone\b|\baddress\b/i);
      expect(source).not.toContain("contentRef");
    }
  });

  test("a staff member is 'you' or 'another staff member', never resolved to a name", () => {
    expect(detail).toContain('t("Another staff member")');
    expect(list).toContain('t("Another staff member")');

    for (const source of [list, detail]) {
      expect(source).not.toContain("assigneeTenantUserId}");
      expect(source).not.toContain("actorTenantUserId}");
    }
  });

  test("there is no reply box, note box or send control", () => {
    for (const source of [list, detail, settings]) {
      expect(source).not.toContain('<textarea name="reply"');
      expect(source).not.toMatch(/send(Message|Reply)|\/send\b/);
    }
  });
});

describe("the actions", () => {
  test("every conversation write carries expectedVersion, and the assignment an Idempotency-Key", () => {
    const script = detail.slice(detail.indexOf("<script>"));

    expect(script.match(/expectedVersion/g)?.length).toBeGreaterThanOrEqual(4);
    expect(script).toContain('"Idempotency-Key"');
    expect(script).toContain("/assignment");
    expect(script).toContain("VERSION_CONFLICT");
  });

  test("every settings write carries an Idempotency-Key", () => {
    const script = settings.slice(settings.indexOf("<script>"));

    for (const url of [
      "/sla-policies`",
      "/retire`",
      "/tags`",
      "/projection/rebuild`"
    ]) {
      expect(script).toContain(url);
    }

    expect(script.match(/idempotency\(/g)?.length).toBeGreaterThanOrEqual(5);
    expect(script).toContain("confirmAction(");
    expect(script).not.toContain("localStorage");
    expect(script).not.toContain("sessionStorage");
  });

  test("'assign to another person' has no endpoint behind it and is DISABLED with its reason", () => {
    expect(detail).toMatch(
      /<button[^>]*\sdisabled\s[^>]*aria-describedby="omnichannel-assign-other-why"/
    );
    expect(detail).toContain('id="omnichannel-assign-other-why"');
    // No control posts an arbitrary assignee id.
    expect(detail).not.toMatch(/name="assignee/);
  });

  test("a customer who cannot be answered disables the writes", () => {
    expect(detail).toContain('conversation?.customerState === "active"');
    expect(detail).toContain("disabled={!reachable}");
  });

  test("scripts import a module, so Astro bundles them under the CSP", () => {
    for (const source of [detail, settings]) {
      const script = source.slice(source.indexOf("<script>"));

      expect(script).toContain('from "../../../lib/ui/admin-form-client"');
    }
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
