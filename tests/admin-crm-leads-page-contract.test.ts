/**
 * `/admin/crm-leads`, `/admin/crm-leads/[id]` and `/admin/crm-leads/settings`
 * gate against the endpoints they drive (Issue #1166, ADR-0153, ADR-0149).
 *
 * Sibling of the other page-contract tests, for the same silent failure: a page
 * gating on a permission key no migration seeds hides the control from EVERYONE,
 * the owner included, while still looking like a working screen. The properties
 * pinned here are the ones the issue makes load-bearing:
 *
 * - every permission the screens name is DECLARED, SEEDED and ENFORCED by the
 *   endpoint behind the control, and each navigation entry opens a page that
 *   exists on a key the page accepts;
 * - the screens read through the module's loaders (which call the API's own
 *   directory functions), never SQL in a page;
 * - no contact value, ciphertext, keyed hash or customer reference is rendered
 *   or selected: the masked view only;
 * - every mutation the scripts send carries `expectedVersion` and an
 *   `Idempotency-Key`, and the action with no endpoint is shown DISABLED;
 * - the scripts are bundled (they import a module, so CSP allows them).
 *
 * Pure: no database, no network. The isolation and behaviour of the loaders are
 * measured against a real database in
 * `tests/integration/crm-leads-screens.integration.test.ts`.
 */
import { readFileSync } from "node:fs";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";
import { stripComments } from "../scripts/lib/source-text";
import { CRM_LEADS_GUARDS } from "../src/modules/crm-leads/domain/crm-leads-constants";

const LIST_PAGE = "src/pages/admin/crm-leads.astro";
const DETAIL_PAGE = "src/pages/admin/crm-leads/[id].astro";
const SETTINGS_PAGE = "src/pages/admin/crm-leads/settings.astro";
/** Comments stripped: the docblocks name the very things the screens must not do. */
const read = (path: string) => stripComments(readFileSync(path, "utf8"));
const list = read(LIST_PAGE);
const detail = read(DETAIL_PAGE);
const settings = read(SETTINGS_PAGE);
/** The chain the pages delegate to; its BEHAVIOUR is the integration test's. */
const loaders = read("src/modules/crm-leads/application/screen-loaders.ts");

/** The literal guard object a page spells out, so the coverage gate (which reads source text) sees it. */
function literalGuard(source: string, name: string) {
  const match = new RegExp(
    `const ${name} = \\{\\s*moduleKey: "([a-z_]+)",\\s*activityCode: "([a-z_]+)",\\s*action: "([a-z_]+)"\\s*\\} as const;`
  ).exec(source);

  expect(match).not.toBeNull();

  return { moduleKey: match![1], activityCode: match![2], action: match![3] };
}

describe("the screens gate on keys that really exist", () => {
  const G = CRM_LEADS_GUARDS;

  test("each literal guard equals the module's own guard constant", () => {
    expect(literalGuard(list, "READ_GUARD")).toEqual(G.readLeads);
    expect(literalGuard(list, "CONFIGURE_GUARD")).toEqual(G.configurePipelines);
    expect(literalGuard(detail, "READ_GUARD")).toEqual(G.readLeads);
    expect(literalGuard(detail, "MOVE_GUARD")).toEqual(G.moveLeads);
    expect(literalGuard(detail, "ASSIGN_GUARD")).toEqual(G.assignLeads);
    expect(literalGuard(settings, "CONFIGURE_GUARD")).toEqual(
      G.configurePipelines
    );
  });

  test("every key is DECLARED by the module and SEEDED by the migration", () => {
    const module = listModules().find((m) => m.key === "crm_leads")!;
    const declared = new Set(
      (module.permissions ?? []).map(
        (permission) =>
          `${module.key}.${permission.activityCode}.${permission.action}`
      )
    );
    const seed = read("sql/343_awcms_crm_leads_permissions.sql");

    for (const guard of Object.values(G)) {
      expect(
        declared.has(`${guard.moduleKey}.${guard.activityCode}.${guard.action}`)
      ).toBe(true);
      expect(seed).toContain(`'${guard.activityCode}'`);
      expect(seed).toContain(`'${guard.action}'`);
    }
  });

  test("each endpoint enforces the key the screen assumes", () => {
    const base = "src/pages/api/v1/crm-leads";
    const expectations: [string, string][] = [
      [`${base}/leads/index.ts`, "CRM_LEADS_GUARDS.readLeads"],
      [`${base}/leads/[id]/index.ts`, "CRM_LEADS_GUARDS.readLeads"],
      [`${base}/leads/[id]/move.ts`, "CRM_LEADS_GUARDS.moveLeads"],
      [`${base}/leads/[id]/assign.ts`, "CRM_LEADS_GUARDS.assignLeads"],
      [`${base}/pipelines/index.ts`, "CRM_LEADS_GUARDS.readLeads"],
      [`${base}/pipelines/[id]/index.ts`, "CRM_LEADS_GUARDS.readLeads"],
      [`${base}/settings.ts`, "CRM_LEADS_GUARDS.configurePipelines"]
    ];

    for (const [route, guard] of expectations) {
      expect(read(route)).toContain(guard);
    }
  });

  test("the sidebar entries open pages that exist, on the key each page accepts", () => {
    const module = listModules().find((m) => m.key === "crm_leads")!;

    expect(module.status).toBe("active");
    expect(module.navigation).toEqual([
      expect.objectContaining({
        path: "/admin/crm-leads",
        requiredPermission: "crm_leads.leads.read"
      }),
      expect.objectContaining({
        path: "/admin/crm-leads/settings",
        requiredPermission: "crm_leads.pipelines.configure"
      })
    ]);
    expect(list).toContain("authorize: READ_GUARD");
    expect(detail).toContain("authorize: READ_GUARD");
    expect(settings).toContain("authorize: CONFIGURE_GUARD");
  });

  test("a control is shown only when the chokepoint allows its permission", () => {
    expect(detail).toContain("moveGuard: MOVE_GUARD");
    expect(detail).toContain("assignGuard: ASSIGN_GUARD");
    expect(list).toContain("configureGuard: CONFIGURE_GUARD");
    expect(loaders).toContain("await can(input.moveGuard)");
    expect(loaders).toContain("await can(input.assignGuard)");
    expect(loaders).toContain("await can(input.configureGuard)");

    for (const source of [list, detail, settings, loaders]) {
      // Never raw RBAC: that skips ABAC and module state.
      expect(source).not.toContain("ssr.permissions.has");
    }
  });

  test("the screens are off with the deployment switch, checked AFTER authorization", () => {
    for (const source of [list, detail, settings]) {
      expect(source).not.toContain("isCrmLeadsEnabled");
      expect(
        source.search(/\bloadLead\w+\(|\bloadCrmSettings\(/)
      ).toBeGreaterThan(source.indexOf("await loadAdminScreen("));
    }

    expect(loaders.match(/if \(!isCrmLeadsEnabled\(\)\)/g)).toHaveLength(3);
  });
});

describe("the screens read through the module's own functions", () => {
  test("no SQL and no directory function in a page", () => {
    for (const source of [list, detail, settings]) {
      expect(source).not.toMatch(
        /listLeads|fetchLeadView|fetchLeadHistory|fetchPipeline|listPipelines|fetchSettings/
      );
      expect(source).not.toMatch(/\btx`/);
      expect(source).not.toContain("awcms_crm_");
    }

    expect(loaders).toContain("listLeads(");
    expect(loaders).toContain("fetchLeadView(");
    expect(loaders).toContain("fetchLeadHistory(");
    expect(loaders).toContain("fetchPipeline(");
  });

  test("the list asks for live leads only, in a bounded read", () => {
    expect(loaders).toContain("includeDeleted: false");
    expect(loaders).toContain("LOAD_PAGE_LIMIT = 2");
    // The source of every row comes from ONE query, not one per row.
    expect(loaders).toContain("lead_id = ANY(");
    expect(list.indexOf("parseDataPageQuery(")).toBeLessThan(
      list.indexOf("await loadAdminScreen(")
    );
  });

  test("the lead is read for the session's tenant, and a deleted or foreign id is one 'not found'", () => {
    expect(detail).toContain("crm-lead-not-found");
    expect(detail).toContain("uuidOrNull(Astro.params.id)");
    expect(loaders).toContain("lead.deletedAt !== null");
    expect(loaders).toContain("fetchLeadView(tx, tenantId, leadId)");
    // The tenant id is the session's, never taken from the URL or the query.
    for (const source of [list, detail, settings]) {
      expect(source).toContain("tenantId: ssr.tenantId");
      expect(source).not.toMatch(/searchParams\.get\("tenant/);
    }
  });

  test("the settings load one catalogue, not one per pipeline", () => {
    expect(loaders.match(/fetchPipeline\(/g)).toHaveLength(2);
    expect(loaders).toContain("selected: wanted ?");
  });
});

describe("no contact value or customer reference is rendered or selected", () => {
  test("the screens read the masked view only", () => {
    for (const source of [list, detail, settings, loaders]) {
      expect(source).not.toMatch(
        /value_encrypted|value_hash|valueHash|decryptField|encryptField|keyedHash|resolveCrmLeadsRings|requireRings/
      );
    }

    // A conversion's opaque customer reference and evidence reference belong to
    // the customer authority; the screen never prints them.
    for (const source of [list, detail, settings]) {
      expect(source).not.toMatch(
        /externalCustomerRef|external_customer_ref|evidenceRef|evidence_ref/
      );
    }

    expect(list).toContain("point.masked");
    expect(detail).toContain("point.masked");
  });

  test("a staff member is 'you' or 'another staff member', never resolved to a name", () => {
    expect(detail).toContain('t("Another staff member")');
    expect(list).toContain('t("Another staff member")');

    for (const source of [list, detail]) {
      expect(source).not.toContain("ownerTenantUserId}");
      expect(source).not.toContain("actorTenantUserId}");
    }
  });
});

describe("the actions", () => {
  test("every lead write carries expectedVersion and an Idempotency-Key", () => {
    const script = detail.slice(detail.indexOf("<script>"));

    expect(script.match(/expectedVersion/g)?.length).toBeGreaterThanOrEqual(2);
    expect(script.match(/"Idempotency-Key"/g)?.length).toBeGreaterThanOrEqual(
      2
    );
    expect(script).toContain("/move`");
    expect(script).toContain("/assign`");
    // The "someone else changed it" sentence is translated on the server.
    expect(detail).toContain("VERSION_CONFLICT: t(");
    expect(script).not.toContain("localStorage");
    expect(script).not.toContain("sessionStorage");
  });

  test("the settings write carries an Idempotency-Key", () => {
    const script = settings.slice(settings.indexOf("<script>"));

    expect(script).toContain('"PATCH"');
    expect(script).toContain("/api/v1/crm-leads/settings");
    expect(script).toContain('"Idempotency-Key"');
  });

  test("a move offers only the pipeline's own edges, never a converted stage", () => {
    expect(detail).toContain("revision.transitions");
    expect(detail).toContain("edge.from === lead.stageKey");
    expect(detail).toContain('target.stage.category !== "converted"');
    expect(detail).toContain("transitionGuardLabel(");
  });

  test("'assign to another person' has no endpoint behind it and is DISABLED with its reason", () => {
    expect(detail).toMatch(
      /<button[^>]*\sdisabled\s[^>]*aria-describedby="crm-lead-assign-other-why"/
    );
    expect(detail).toContain('id="crm-lead-assign-other-why"');
    // No control posts an arbitrary owner id.
    expect(detail).not.toMatch(/name="owner/);
  });

  test("a lead that cannot be written (tenant switch off, not open) disables the writes", () => {
    expect(detail).toContain("detail.tenantEnabled");
    expect(detail).toContain('lead?.status === "open"');
    expect(detail).toContain("disabled={!writable");
  });

  test("scripts import a module, so Astro bundles them under the CSP and the sentences arrive translated", () => {
    for (const source of [detail, settings]) {
      const script = source.slice(source.indexOf("<script>"));

      expect(script).toContain('from "../../../lib/ui/admin-form-client"');
      expect(source).toContain("data-messages={JSON.stringify(messages)}");
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

describe("the affordances are gated by the chokepoint and the lead's state (audit L-4)", () => {
  test("the move and assign sections render only behind their own probe", () => {
    expect(detail).toContain("{detail.canMove && (");
    expect(detail).toContain("{detail.canAssign && (");
    expect(detail).toContain("{(detail.canMove || detail.canAssign) && (");
  });

  test("every control of a move form is disabled unless the lead is writable", () => {
    const move = detail.slice(
      detail.indexOf("{detail.canMove && ("),
      detail.indexOf("{detail.canAssign && (")
    );

    expect(move.match(/disabled=\{!writable\}/g)?.length).toBe(3);
    expect(move).not.toContain("disabled={false}");
  });

  test("an assign control is disabled unless writable", () => {
    const assign = detail.slice(detail.indexOf("{detail.canAssign && ("));

    expect(assign.match(/disabled=\{!writable \|\|/g)?.length).toBe(2);
  });

  test("the settings form sends only the changed fields", () => {
    expect(settings).toContain("settingsPatchFromForm(");
    expect(settings).not.toMatch(/const body = \{\s*enabled:/);
  });
});
