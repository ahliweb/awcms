/**
 * The five crm_leads WRITE screens gate against the endpoints they drive
 * (Issue #1166, ADR-0153): `/admin/crm-leads/new`, `/deleted`, and under a
 * lead `/edit`, `/merge`, `/conversion`.
 *
 * Sibling of `admin-crm-leads-page-contract.test.ts`, for the same silent
 * failure (a page gating on a key no migration seeds hides its control from
 * EVERYONE) and for the properties that make a write screen safe:
 *
 * - each screen's entry guard is the permission of the endpoint behind its
 *   control, and that permission is declared AND seeded;
 * - every mutation the scripts send carries an `Idempotency-Key`, the version
 *   the page saw, and (conversion, intake) a stable `occurredAt`;
 * - the screens read through the module's loaders, never SQL in a page, and
 *   print no contact value, ciphertext or hash;
 * - the seven permissions that were on the `NOT_YET_SCREENED` ledger are gone
 *   from it, and the screens that claim them are real pages.
 *
 * Pure: no database. The BEHAVIOUR of the loaders (tenant isolation, masking,
 * merge candidates, the partial index) is measured against a real database in
 * `tests/integration/crm-leads-write-screens.integration.test.ts`.
 */
import { existsSync, readFileSync } from "node:fs";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";
import { NOT_YET_SCREENED } from "../scripts/admin-screen-coverage-ledger";
import { extractScreenClaims } from "../scripts/admin-screen-coverage-check";
import { stripComments } from "../scripts/lib/source-text";
import { CRM_LEADS_GUARDS } from "../src/modules/crm-leads/domain/crm-leads-constants";

const PAGES = {
  new: "src/pages/admin/crm-leads/new.astro",
  deleted: "src/pages/admin/crm-leads/deleted.astro",
  edit: "src/pages/admin/crm-leads/[id]/edit.astro",
  merge: "src/pages/admin/crm-leads/[id]/merge.astro",
  conversion: "src/pages/admin/crm-leads/[id]/conversion.astro"
} as const;
/** Comments stripped: the docblocks name the very things the screens must not do. */
const read = (path: string) => stripComments(readFileSync(path, "utf8"));
const source = Object.fromEntries(
  Object.entries(PAGES).map(([name, path]) => [name, read(path)])
) as Record<keyof typeof PAGES, string>;
const loaders = read(
  "src/modules/crm-leads/application/screen-write-loaders.ts"
);

function literalGuard(page: string, name: string) {
  const match = new RegExp(
    `const ${name} = \\{\\s*moduleKey: "([a-z_]+)",\\s*activityCode: "([a-z_]+)",\\s*action: "([a-z_]+)"\\s*\\} as const;`
  ).exec(page);

  expect(match).not.toBeNull();

  return { moduleKey: match![1], activityCode: match![2], action: match![3] };
}

describe("each screen gates on the permission of the endpoint behind its control", () => {
  const G = CRM_LEADS_GUARDS;

  test("the literal guards equal the module's own", () => {
    expect(literalGuard(source.new, "CREATE_GUARD")).toEqual(G.createLeads);
    expect(literalGuard(source.edit, "UPDATE_GUARD")).toEqual(G.updateLeads);
    expect(literalGuard(source.edit, "DELETE_GUARD")).toEqual(G.deleteLeads);
    expect(literalGuard(source.deleted, "RESTORE_GUARD")).toEqual(
      G.restoreLeads
    );
    expect(literalGuard(source.merge, "MERGE_GUARD")).toEqual(G.manageMerges);
    expect(literalGuard(source.conversion, "READ_GUARD")).toEqual(G.readLeads);
    expect(literalGuard(source.conversion, "APPROVE_GUARD")).toEqual(
      G.confirmConversions
    );
    expect(literalGuard(source.conversion, "MANUAL_GUARD")).toEqual(
      G.manualConversions
    );
  });

  test("the entry of each screen is its write permission", () => {
    expect(source.new).toContain("authorize: CREATE_GUARD");
    expect(source.edit).toContain("authorize: UPDATE_GUARD");
    expect(source.deleted).toContain("authorize: RESTORE_GUARD");
    expect(source.merge).toContain("authorize: MERGE_GUARD");
    // Conversion: read is the entry, the two writes are probes of the chokepoint.
    expect(source.conversion).toContain("authorize: READ_GUARD");
    expect(source.conversion).toContain("approveGuard: APPROVE_GUARD");
    expect(source.conversion).toContain("manualGuard: MANUAL_GUARD");
    expect(source.edit).toContain("deleteGuard: DELETE_GUARD");
    expect(loaders).toContain("await input.can(input.deleteGuard)");
    expect(loaders).toContain("await input.can(input.approveGuard)");
    expect(loaders).toContain("await input.can(input.manualGuard)");

    for (const page of Object.values(source)) {
      expect(page).not.toContain("ssr.permissions.has");
    }
  });

  test("each endpoint enforces the key the screen assumes", () => {
    const base = "src/pages/api/v1/crm-leads";
    const expectations: [string, string][] = [
      [`${base}/leads/index.ts`, "CRM_LEADS_GUARDS.createLeads"],
      [`${base}/leads/[id]/index.ts`, "CRM_LEADS_GUARDS.updateLeads"],
      [`${base}/leads/[id]/index.ts`, "CRM_LEADS_GUARDS.deleteLeads"],
      [`${base}/leads/[id]/restore.ts`, "CRM_LEADS_GUARDS.restoreLeads"],
      [`${base}/leads/merge.ts`, "CRM_LEADS_GUARDS.manageMerges"],
      [`${base}/merges/[id]/revert.ts`, "CRM_LEADS_GUARDS.manageMerges"],
      [
        `${base}/leads/[id]/conversions.ts`,
        "CRM_LEADS_GUARDS.confirmConversions"
      ],
      [
        `${base}/leads/[id]/manual-conversions.ts`,
        "CRM_LEADS_GUARDS.manualConversions"
      ],
      [
        `${base}/conversions/[id]/reverse.ts`,
        "CRM_LEADS_GUARDS.confirmConversions"
      ],
      [`${base}/leads/[id]/candidates.ts`, "CRM_LEADS_GUARDS.readLeads"]
    ];

    for (const [route, guard] of expectations) {
      expect(read(route)).toContain(guard);
    }
  });

  test("every key is declared by the module and seeded by the migration", () => {
    const module = listModules().find((m) => m.key === "crm_leads")!;
    const declared = new Set(
      (module.permissions ?? []).map(
        (permission) =>
          `${module.key}.${permission.activityCode}.${permission.action}`
      )
    );
    const seed = read("sql/343_awcms_crm_leads_permissions.sql");

    for (const guard of Object.values(CRM_LEADS_GUARDS)) {
      expect(
        declared.has(`${guard.moduleKey}.${guard.activityCode}.${guard.action}`)
      ).toBe(true);
      expect(seed).toContain(`'${guard.activityCode}'`);
      expect(seed).toContain(`'${guard.action}'`);
    }
  });

  test("the two static pages have a navigation entry on the key they accept; the others are dynamic children of the lead", () => {
    const module = listModules().find((m) => m.key === "crm_leads")!;
    const nav = new Map(
      (module.navigation ?? []).map((entry) => [
        entry.path,
        entry.requiredPermission
      ])
    );

    expect(nav.get("/admin/crm-leads/new")).toBe("crm_leads.leads.create");
    expect(nav.get("/admin/crm-leads/deleted")).toBe("crm_leads.leads.restore");

    for (const page of [PAGES.new, PAGES.deleted]) {
      expect(existsSync(page)).toBe(true);
    }

    for (const page of [PAGES.edit, PAGES.merge, PAGES.conversion]) {
      expect(existsSync(page)).toBe(true);
      expect(page).toContain("/[id]/");
    }

    expect(existsSync("src/pages/admin/crm-leads/[id].astro")).toBe(true);
  });
});

describe("the ledger shrank by exactly the permissions these screens claim", () => {
  const SEVEN = [
    "crm_leads.conversions.approve",
    "crm_leads.leads.create",
    "crm_leads.leads.delete",
    "crm_leads.leads.restore",
    "crm_leads.leads.update",
    "crm_leads.manual_conversions.create",
    "crm_leads.merges.manage"
  ];

  test("none of the seven is still awaiting a screen, and the screens claim each", () => {
    const claimed = new Set<string>();

    for (const page of Object.values(PAGES)) {
      for (const key of extractScreenClaims(readFileSync(page, "utf8"))) {
        claimed.add(key);
      }
    }

    for (const key of SEVEN) {
      expect(NOT_YET_SCREENED).not.toContain(key);
      expect(claimed.has(key)).toBe(true);
    }
  });
});

describe("the screens read through the module's loaders and print no secret", () => {
  test("no SQL and no directory function in a page", () => {
    for (const page of Object.values(source)) {
      expect(page).not.toMatch(
        /listLeads|listDeletedLeads|fetchLeadView|fetchLeadHistory|fetchPipeline|listPipelines|fetchSettings|findCandidates/
      );
      expect(page).not.toMatch(/\btx`/);
      expect(page).not.toContain("awcms_crm_");
      expect(page).toContain("tenantId: ssr.tenantId");
      expect(page).not.toMatch(/searchParams\.get\("tenant/);
    }
  });

  test("the deployment switch is checked in the loader, AFTER the screen's authorization", () => {
    for (const page of Object.values(source)) {
      expect(page).not.toContain("isCrmLeadsEnabled");
      expect(page.search(/\bload(Lead|Deleted)\w+\(/)).toBeGreaterThan(
        page.indexOf("await loadAdminScreen(")
      );
    }

    expect(loaders.match(/if \(!isCrmLeadsEnabled\(\)\)/g)).toHaveLength(5);
  });

  test("only the masked view is rendered; nothing decrypts or hashes", () => {
    for (const text of [...Object.values(source), loaders]) {
      expect(text).not.toMatch(
        /value_encrypted|value_hash|valueHash|decryptField|encryptField|keyedHash|resolveCrmLeadsRings|requireRings/
      );
    }

    for (const page of [source.deleted, source.edit, source.merge]) {
      expect(page).toContain("point.masked");
    }

    // A customer reference / evidence reference is neither read nor printed:
    // the loader cuts the conversion rows down and drops the lead's reference.
    expect(loaders).toContain("externalCustomerRef: _omitted");
    expect(loaders).not.toMatch(/evidenceRef|evidence_ref/);
    expect(source.conversion).not.toMatch(
      /row\.evidenceRef|\.externalCustomerRef\b/
    );
  });

  test("a staff member is never resolved to a name", () => {
    for (const page of Object.values(source)) {
      expect(page).not.toContain("ownerTenantUserId}");
      expect(page).not.toContain("actorTenantUserId}");
    }
  });
});

describe("the scripts' writes", () => {
  const script = (page: string) => page.slice(page.indexOf("<script>"));

  test("every write carries an Idempotency-Key and the page's translated sentences", () => {
    for (const page of Object.values(source)) {
      const text = script(page);

      expect(text).toContain('"Idempotency-Key"');
      expect(text).toContain("createIdempotencyKeySource()");
      expect(text).toContain("failureText(messages");
      expect(page).toContain("data-messages={JSON.stringify(messages)}");
      // Bundled: the script imports a module, so the CSP allows it.
      expect(text).toContain("lib/ui/admin-form-client");
      expect(text).not.toContain("localStorage");
      expect(text).not.toContain("sessionStorage");
    }
  });

  test("an edit, a delete and a restore carry the version the page saw", () => {
    const edit = script(source.edit);

    expect(edit).toContain("expectedVersion: version");
    expect(edit).toContain('"If-Match": `"${version}"`');
    expect(edit).toContain('"PATCH"');
    expect(edit).toContain('"DELETE"');
    // Only what changed is sent: an untouched field must not undo another edit.
    expect(edit).toContain("name !== initialName");
    expect(script(source.deleted)).toContain("expectedVersion");
    expect(script(source.deleted)).toContain("/restore`");
  });

  test("a merge names both versions the reviewer saw, needs a note, and asks first", () => {
    const merge = script(source.merge);

    expect(merge).toContain("survivorVersion");
    expect(merge).toContain("absorbedVersion");
    expect(merge).toContain("note");
    expect(merge.match(/confirmAction\(/g)?.length).toBe(2);
    expect(merge).toContain("/api/v1/crm-leads/leads/merge");
    expect(merge).toContain("/revert`");
  });

  test("a conversion and an intake send a stable occurredAt so a retry replays", () => {
    for (const page of [source.conversion, source.new]) {
      const text = script(page);

      expect(text).toContain("createInstantSource()");
      expect(text).toContain("occurredAt: instantFor(");
    }

    const conversion = script(source.conversion);

    expect(conversion).toContain("manual-conversions");
    expect(conversion).toContain("/reverse`");
    expect(conversion).toContain("expectedVersion: version");
    expect(conversion.match(/confirmAction\(/g)?.length).toBe(2);
    // The customer reference belongs to a confirmed conversion only.
    expect(conversion).toContain('mode === "authority_confirmed" && customer');
  });

  test("a created lead is a manual-source intake; the form posts no owner id the viewer typed", () => {
    const text = script(source.new);

    expect(text).toContain('kind: "manual"');
    expect(text).toContain("/api/v1/crm-leads/leads");
    // The only owner the form can name is the viewer.
    expect(source.new).not.toMatch(/name="owner/);
    expect(text).toContain("ownerTenantUserId: me");
  });

  test("each control is disabled unless the lead is writable", () => {
    expect(source.edit).toContain("<fieldset disabled={!editable}>");
    expect(source.merge).toContain(
      "<fieldset disabled={!writable || !candidate.samePipeline}>"
    );
    expect(source.conversion).toContain("<fieldset disabled={!mayRecord}>");
    expect(source.deleted).toContain("disabled={!data.tenantEnabled}");
  });
});

describe("the list and detail link to a write page only behind the chokepoint", () => {
  const list = read("src/pages/admin/crm-leads.astro");
  const detail = read("src/pages/admin/crm-leads/[id].astro");
  const screenLoaders = read(
    "src/modules/crm-leads/application/screen-loaders.ts"
  );

  test("links render behind their probes", () => {
    expect(list).toContain("{data.canCreate && (");
    expect(list).toContain("{data.canRestore && (");
    expect(detail).toContain("{detail.canEdit && (");
    expect(detail).toContain("{detail.canMerge && (");
    expect(detail).toContain("{detail.canConvert && (");
    expect(screenLoaders).toContain("await can(writeGuards.update)");
    expect(screenLoaders).toContain("await can(writeGuards.merge)");
    expect(screenLoaders).toContain("await can(writeGuards.approve)");
    expect(screenLoaders).toContain("await can(writeGuards.manual)");
    expect(screenLoaders).toContain("await can(input.writeGuards.create)");
    expect(screenLoaders).toContain("await can(input.writeGuards.restore)");
  });
});
