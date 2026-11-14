/**
 * `/admin/users` links to `/admin/invitations` instead of looking as if the
 * feature were missing.
 *
 * There is deliberately no `POST /api/v1/users`: an administrator never mints
 * another person's credential, people arrive by invitation (ADR-0082). The
 * roster used to give no way to reach the invitation form, so an owner reading
 * it concluded the feature was absent.
 *
 * A page-contract test in the style of `admin-invitations-page-contract.test.ts`:
 * pure source inspection, no database, no network. It proves the RENDER gate is
 * decided from keys a module actually declares, that the link needs BOTH
 * `invitations.create` and `invitations.read`, and that it targets an anchor
 * that exists on the destination. The endpoints still decide every request.
 *
 * Traps this guards against:
 *
 * - **A link gated on a key nothing declares** hides the control from everyone,
 *   the owner included, while the page still looks like a working screen.
 * - **`create` without `read`.** `/admin/invitations` renders nothing without
 *   `read`, so a link gated on `create` alone lands the caller on a permission
 *   notice.
 * - **A dead anchor.** The form heading the link points at must exist on the
 *   invitations page.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";

const PAGE = "src/pages/admin/users.astro";
const INVITATIONS_PAGE = "src/pages/admin/invitations.astro";

function declaredKeys(): Set<string> {
  const declared = new Set<string>();

  for (const module of listModules()) {
    for (const permission of module.permissions ?? []) {
      declared.add(
        `${module.key}.${permission.activityCode}.${permission.action}`
      );
    }
  }

  return declared;
}

function block(page: string, marker: string): string {
  const start = page.indexOf(marker);

  expect(start).toBeGreaterThan(-1);

  return page.slice(start, start + 200);
}

describe("/admin/users links to invitations, on the right keys", () => {
  test("both keys are declared by a module, so a migration seeds them", () => {
    const declared = declaredKeys();

    expect(declared.has("identity_access.invitations.create")).toBe(true);
    expect(declared.has("identity_access.invitations.read")).toBe(true);
  });

  test("each flag is asked of the chokepoint with the same shape the invitations screen uses", async () => {
    const page = await readFile(PAGE, "utf8");

    const create = block(page, "canInviteCreate: await can({");
    expect(create).toContain('moduleKey: "identity_access"');
    expect(create).toContain('activityCode: "invitations"');
    expect(create).toContain('action: "create"');

    const read = block(page, "canReadInvitations: await can({");
    expect(read).toContain('moduleKey: "identity_access"');
    expect(read).toContain('activityCode: "invitations"');
    expect(read).toContain('action: "read"');
  });

  test("the link needs create AND read, never one alone", async () => {
    const page = await readFile(PAGE, "utf8");

    expect(page).toMatch(
      /const canInvite =\s*screen\.state === "allowed" &&\s*screen\.data\.canInviteCreate &&\s*screen\.data\.canReadInvitations;/
    );
    // Rendered only behind that single flag, and it is a link, not a control
    // that mutates anything from this page.
    expect(page).toMatch(/canInvite && \(\s*<a\s/);
    expect(page).toContain('href="/admin/invitations#invitations-new-heading"');
    expect(page).toContain('t("Invite user")');
    expect(page).not.toMatch(/\/api\/v1\/invitations/);
  });

  test("the anchor it targets exists on the invitations page", async () => {
    const invitations = await readFile(INVITATIONS_PAGE, "utf8");

    expect(invitations).toContain('id="invitations-new-heading"');
  });

  test("the label has an Indonesian translation", async () => {
    const id = await readFile("locales/id.po", "utf8");

    expect(id).toContain('msgid "Invite user"\nmsgstr "Undang pengguna"');
  });
});
