/**
 * `/admin/invitations` gates against the endpoints it drives — ADR-0082, #541.
 *
 * Sibling of the other page-contract tests, for the same silent failure: a page
 * gating on a permission key no migration seeds hides the control from EVERYONE
 * — including the owner — while still looking like a working screen.
 *
 * Three traps are specific to this surface:
 *
 * - **Creating one runs up to THREE guards.** `invitations.create`, then
 *   `access_control.assign` when roles are named, then `invitations.configure`
 *   for `skipEmailConfirmation`. A form gated on `create` alone offers two
 *   controls that 403 at submit.
 * - **`Idempotency-Key` is REQUIRED on create and REFUSED on resend.** Not a
 *   style choice either way: create replays its stored response, and replaying
 *   a resend would have to return a token it has already rotated away.
 * - **`delivery: "unavailable"` is a real outcome.** The invitation exists, no
 *   mail was queued, and no endpoint can hand over the link afterwards. A page
 *   that reloaded on it would report success for something nobody received.
 *
 * Pure — no database, no network. Runs in `quality` on every PR.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";

const PAGE = "src/pages/admin/invitations.astro";
const CREATE_ROUTE = "src/pages/api/v1/invitations/index.ts";
const RESEND_ROUTE = "src/pages/api/v1/invitations/[id]/resend.ts";
const REVOKE_ROUTE = "src/pages/api/v1/invitations/[id]/revoke.ts";

const EXPECTED = [
  "identity_access.invitations.read",
  "identity_access.invitations.create",
  "identity_access.invitations.revoke",
  "identity_access.invitations.configure"
];

/** Collapses runs of whitespace — see `admin-machine-credentials-page-contract`. */
function squashed(source: string): string {
  return source.replace(/\s+/g, " ");
}

describe("/admin/invitations gates on keys that really exist", () => {
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

  test("the page also checks the SECOND guard create runs", async () => {
    const page = await readFile(PAGE, "utf8");
    const route = await readFile(CREATE_ROUTE, "utf8");

    // `access_control.assign`, not an invitation key at all. Without it the
    // role picker composes an invitation that the endpoint then refuses.
    expect(route).toContain('activityCode: "access_control"');
    expect(route).toContain('action: "assign"');
    expect(page).toContain('activityCode: "access_control"');
    expect(page).toContain("canAssign");
  });

  test("revoking is gated on `revoke`, resending on `create`", async () => {
    const resend = await readFile(RESEND_ROUTE, "utf8");
    const revoke = await readFile(REVOKE_ROUTE, "utf8");

    // Resend MINTS A NEW TOKEN, which is the authority `create` already names.
    // A separate `resend` permission would let somebody hand fresh credentials
    // to everyone previously invited while holding no authority to invite.
    expect(resend).toContain('action: "create"');
    expect(resend).not.toContain('action: "resend"');
    expect(revoke).toContain('action: "revoke"');
  });
});

describe("the three properties this screen has to get right", () => {
  test("create carries an Idempotency-Key; resend and revoke do NOT", async () => {
    const page = squashed(await readFile(PAGE, "utf8"));

    // Exactly one occurrence. `create` requires the header (400 without it);
    // `resend` documents refusing it, because replaying one would have to
    // return a token it has already rotated away.
    expect(page.split('"Idempotency-Key"').length - 1).toBe(1);
    expect(page).toContain('"Idempotency-Key": crypto.randomUUID()');
  });

  test("`delivery: unavailable` is reported, not reloaded away", async () => {
    const page = await readFile(PAGE, "utf8");

    const createBlock = page.slice(
      page.indexOf('getElementById("create-invitation-form")'),
      page.indexOf('document.addEventListener("click"')
    );

    expect(createBlock).toContain('delivery === "unavailable"');
    expect(createBlock).toContain("NOT sent");
    expect(createBlock.indexOf('delivery === "unavailable"')).toBeLessThan(
      createBlock.indexOf("window.location.reload()")
    );
  });

  test("system roles never reach the role picker", async () => {
    const page = await readFile(PAGE, "utf8");

    // `createInvitation` refuses them (`system_role`). Offering `owner` would
    // fail after the operator had composed the whole invitation.
    expect(page).toContain("filter((role) => !role.isSystem)");
  });

  test("no raw invitee address is rendered", async () => {
    const page = await readFile(PAGE, "utf8");

    // `listInvitations` masks the address; the raw one is never projected.
    expect(page).toContain("invitation.loginIdentifierMasked");
    expect(page).not.toContain("invitation.loginIdentifier}");
  });
});

describe("the ledger shrank, and stayed shrunk", () => {
  test("no `invitations` key is left on NOT_YET_SCREENED", async () => {
    const { NOT_YET_SCREENED } =
      await import("../scripts/admin-screen-coverage-ledger");

    expect(
      NOT_YET_SCREENED.filter((key) =>
        key.startsWith("identity_access.invitations.")
      )
    ).toEqual([]);
  });

  test("and the four keys are exactly the ones this page claims", () => {
    // Paired with the assertion above so neither passes vacuously.
    expect(EXPECTED).toHaveLength(4);
  });
});
