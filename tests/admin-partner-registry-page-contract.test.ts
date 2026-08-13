/**
 * `/admin/partner-registry` gates against the endpoint it drives — ADR-0089, #540.
 *
 * Sibling of the other page-contract tests, plus one thing none of them have to
 * check: this screen is PLATFORM-scoped, and the two mechanisms that keep it so
 * are independent. FORCE RLS puts every row under the platform tenant; the
 * chokepoint refuses a platform-scoped permission unless the acting tenant IS
 * the platform tenant. Neither is a backstop for the other.
 *
 * The trap specific to this surface is a placement one, and it is the whole
 * reason the issue existed: the registry must NOT live on `/admin/partners`.
 * That page is the customer's view of who reaches its own tenant, and the
 * registry there would put the platform's list of every partnership in front of
 * every customer — the cross-tenant directory ADR-0089 refused as a table,
 * rebuilt as a screen.
 *
 * Pure — no database, no network. Runs in `quality` on every PR.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";
import {
  isPlatformScopedPermissionKey,
  resetPlatformScopeCacheForTests
} from "../src/modules/identity-access/domain/platform-scope";

const PAGE = "src/pages/admin/partner-registry.astro";
const CUSTOMER_PAGE = "src/pages/admin/partners.astro";
const ROUTE = "src/pages/api/v1/partners/index.ts";

const EXPECTED = [
  "identity_access.partner_registry.read",
  "identity_access.partner_registry.create"
];

describe("/admin/partner-registry gates on keys that really exist", () => {
  test("every key the page names is DECLARED by a module", async () => {
    const page = await readFile(PAGE, "utf8");

    const declared = new Set<string>();
    for (const module of listModules()) {
      for (const permission of module.permissions ?? []) {
        declared.add(
          `${module.key}.${permission.activityCode}.${permission.action}`
        );
      }
    }

    for (const key of EXPECTED) {
      const [, activityCode, action] = key.split(".");
      expect(page).toContain(`activityCode: "${activityCode}"`);
      expect(page).toContain(`action: "${action}"`);
      expect(declared.has(key)).toBe(true);
    }
  });

  test("the page and its endpoint agree on the activity", async () => {
    const route = await readFile(ROUTE, "utf8");
    expect(route).toContain('activityCode: "partner_registry"');
  });

  test("both keys are PLATFORM-scoped, read from the live registry", () => {
    resetPlatformScopeCacheForTests();

    for (const key of EXPECTED) {
      expect(isPlatformScopedPermissionKey(key)).toBe(true);
    }
  });

  test("the nav link is gated on the platform key, not a tenant one", async () => {
    const module = await readFile(
      "src/modules/identity-access/module.ts",
      "utf8"
    );

    // The reason `/admin/tenants` records: there is no tenant-readable half of
    // this screen, so a link gated on anything a customer can hold would put an
    // entry in their sidebar that always answers 403.
    expect(module).toContain(
      'requiredPermission: "identity_access.partner_registry.read"'
    );
    expect(module).toContain('path: "/admin/partner-registry"');
  });
});

describe("the placement, which is the point of the issue", () => {
  test("the CUSTOMER's page does not name the registry activity", async () => {
    const customerPage = await readFile(CUSTOMER_PAGE, "utf8");

    // `/admin/partners` gates on `partner_access`, the customer's own key.
    // A `partner_registry` guard appearing there would mean the platform's list
    // of every partnership had been rendered into a customer screen.
    expect(customerPage).toContain('activityCode: "partner_access"');
    expect(customerPage).not.toContain("partner_registry");
  });

  test("and the registry page does not name the customer activity", async () => {
    const page = await readFile(PAGE, "utf8");

    expect(page).not.toContain('activityCode: "partner_access"');
  });
});

describe("what the screen deliberately cannot do", () => {
  test("there is no delete — the rows are FK targets that outlive engagements", async () => {
    const page = await readFile(PAGE, "utf8");
    const route = await readFile(ROUTE, "utf8");

    expect(page).not.toContain('"DELETE"');
    expect(route).not.toContain("export const DELETE");
  });

  test("there is no tenant picker, and the page says why", async () => {
    const page = await readFile(PAGE, "utf8");

    // A selectable list of every tenant is the directory ADR-0089 declines to
    // hand out. `/admin/tenants` exists for a platform operator who needs to
    // look one up, which is the permission boundary that should decide it.
    expect(page).toContain("no picker on purpose");
    expect(page).toContain('id="register-partner-tenant-id"');
  });

  test("REGISTERING never submits a status — the row starts active by default", async () => {
    const page = await readFile(PAGE, "utf8");

    // Scoped to the register call alone. `status` is now a real, writable
    // value (ADR-0093), but it is not part of registration: a form that could
    // register a partner already suspended would be composing two decisions
    // gated on two different permissions as one request.
    const registerCall = page.slice(
      page.indexOf('sendJson("POST", "/api/v1/partners"'),
      page.indexOf("function wireStatus(")
    );

    expect(registerCall.length).toBeGreaterThan(100);
    expect(registerCall).not.toContain("status");
  });

  test("suspending and reinstating are gated SEPARATELY, and named as such", async () => {
    const page = await readFile(PAGE, "utf8");

    // Two authorities, two permissions, two buttons. One control doing both
    // would hand whoever can stop a partner the power to start one again.
    expect(page).toContain('action: "disable"');
    expect(page).toContain('action: "restore"');
    expect(page).toContain("canSuspend");
    expect(page).toContain("canReinstate");
  });

  test("and the screen says plainly that suspension deletes nothing", async () => {
    const page = await readFile(PAGE, "utf8");

    // `sql/120` made a grant outlive its engagement so that "who could see our
    // data, and until when" stays answerable afterwards. An operator pressing
    // Suspend must not believe they are erasing that record.
    expect(page).toContain("No grant is deleted");
    expect(page).toContain("every grant row");
  });
});

describe("the ledger shrank, and stayed shrunk", () => {
  test("no `partner_registry` key is left on NOT_YET_SCREENED", async () => {
    const { NOT_YET_SCREENED } =
      await import("../scripts/admin-screen-coverage-ledger");

    expect(
      NOT_YET_SCREENED.filter((key) => key.includes("partner_registry"))
    ).toEqual([]);
  });

  test("and the two keys are exactly the ones this page claims", () => {
    // Paired with the assertion above so neither passes vacuously.
    expect(EXPECTED).toHaveLength(2);
  });
});
