/**
 * `/admin/partners` gates against the endpoints it drives — ADR-0089/0090.
 *
 * Sibling of the other page-contract tests, for the same silent failure: a page
 * gating on a permission key no migration seeds hides the control from EVERYONE
 * — including the owner — while still looking like a working screen. This repo
 * has shipped that bug twice by inventing a plausible action name.
 *
 * This screen sets two traps of its own:
 *
 * - **Engaging and severing share ONE permission**, `partner_access.configure`.
 *   A page that gated Sever on a `partner_access.delete` it invented would hide
 *   the control that ENDS another organisation's access — from the person most
 *   likely to be reaching for it in a hurry.
 * - **Approving and revoking share `partner_access.assign`**, not `create` and
 *   not `revoke`. The permission is the authority to hand a role to somebody
 *   outside, and taking it back is the same authority.
 *
 * It also pins the two properties that are the point of the whole surface: the
 * access code is never re-fetched, and there is no partner directory.
 *
 * Pure — no database, no network. Runs in `quality` on every PR.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";

const PAGE = "src/pages/admin/partners.astro";
const ROUTES = [
  "src/pages/api/v1/access/partner-engagements/index.ts",
  "src/pages/api/v1/access/partner-engagements/[id].ts",
  "src/pages/api/v1/access/delegated-grants/index.ts",
  "src/pages/api/v1/access/delegated-grants/[id].ts"
];

const EXPECTED = [
  "identity_access.partner_access.read",
  "identity_access.partner_access.configure",
  "identity_access.partner_access.assign"
];

describe("/admin/partners gates on keys that really exist", () => {
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
      // The page states its guards as `AccessRequest` object literals, the same
      // shape the routes use.
      expect(page).toContain(`activityCode: "${activityCode}"`);
      expect(page).toContain(`action: "${action}"`);
      expect(declared.has(key)).toBe(true);
    }
  });

  test("the page and its four endpoints agree on the activity", async () => {
    // A page gating on `partner_access` while an endpoint gates on something
    // else is a control that renders and then 403s — the shape that reads as a
    // broken product rather than a wrong gate.
    for (const route of ROUTES) {
      const source = await readFile(route, "utf8");
      expect(source).toContain('activityCode: "partner_access"');
    }
  });

  /**
   * Reads the GUARD constant only.
   *
   * A whole-file `not.toContain` would be wrong here, and wrongly: both routes
   * also write an audit row whose `action` is the DOMAIN verb (`delete`,
   * `revoke`). Audit action and guard action are different things in this repo
   * — the offices restore surface makes the same distinction — and a test that
   * conflates them fails on correct code, which is worse than not testing.
   */
  function guardBlock(source: string, name: string): string {
    const start = source.indexOf(`const ${name} = {`);
    return source.slice(start, source.indexOf("} as const;", start));
  }

  test("severing is gated on `configure`, not an invented delete", async () => {
    const guard = guardBlock(
      await readFile(
        "src/pages/api/v1/access/partner-engagements/[id].ts",
        "utf8"
      ),
      "CONFIGURE_GUARD"
    );

    expect(guard).toContain('action: "configure"');
    expect(guard).not.toContain('action: "delete"');
  });

  test("revoking is gated on `assign`, not an invented revoke", async () => {
    const guard = guardBlock(
      await readFile(
        "src/pages/api/v1/access/delegated-grants/[id].ts",
        "utf8"
      ),
      "ASSIGN_GUARD"
    );

    expect(guard).toContain('action: "assign"');
    expect(guard).not.toContain('action: "revoke"');
  });
});

describe("the two properties the surface exists to keep", () => {
  test("approval does NOT reload — the code would be lost", async () => {
    const page = await readFile(PAGE, "utf8");

    const approveBlock = page.slice(
      page.indexOf('getElementById("approve-grant-form")'),
      page.indexOf('document.addEventListener("click"')
    );

    // It reads the response body instead. A reload here spends a grant that
    // then has to be revoked and re-approved.
    expect(approveBlock).toContain("sendJsonForData");
    expect(approveBlock).toContain("accessCode");
    expect(approveBlock).not.toContain("window.location.reload()");
  });

  test("there is no partner picker, and the page says why", async () => {
    const page = await readFile(PAGE, "utf8");

    // ADR-0089 refused a readable directory of the platform's partners. A
    // `<select>` of partners here would be that directory, rebuilt in the UI.
    expect(page).toContain("no partner directory to pick from");
    expect(page).toContain('id="engage-partner-tenant-id"');
  });

  test("system roles never reach the role picker", async () => {
    const page = await readFile(PAGE, "utf8");

    // Redemption refuses them (`materializeMembership`). Offering `owner` would
    // fail at the far end of an out-of-band code handover — the worst moment to
    // find out.
    expect(page).toContain("filter((role) => !role.isSystem)");
  });
});

describe("the ledger shrank, and stayed shrunk", () => {
  test("no `partner_access` key is left on NOT_YET_SCREENED", async () => {
    const { NOT_YET_SCREENED } =
      await import("../scripts/admin-screen-coverage-ledger");

    // The ledger may only shrink, and this is what makes its length mean
    // something: a screen that exists while its keys sit here is a claim that
    // the work is undone when it is done.
    expect(
      NOT_YET_SCREENED.filter((key) => key.includes("partner_access"))
    ).toEqual([]);
  });
});
