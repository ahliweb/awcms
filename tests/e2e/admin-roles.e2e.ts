/**
 * Authenticated admin write-action E2E (Issue #171) — exercises the
 * permission-gated role CRUD on `/admin/roles`: log in through the real
 * `/login` form → session cookies → create a role via the create form →
 * `POST /api/v1/roles` (cookie auth) → page reload → the new row appears in the
 * SSR-rendered `#roles-table` → the row exposes rename / delete / manage-
 * permissions controls.
 *
 * Env-gated exactly like `admin-offices-create.e2e.ts`: the CI `e2e-smoke` job
 * seeds a tenant + owner via `POST /api/v1/setup/initialize` and hands the
 * credentials through env vars. Skipped (not failed) when they are absent, so a
 * local `bun run test:e2e` without a seeded DB stays green. The seeded owner
 * role holds every permission, so `access_control.configure` passes and the
 * create form + action controls render.
 */
import { test, expect } from "@playwright/test";
import { provideTenant } from "./support/e2e-auth";

const tenantId = process.env.E2E_TENANT_ID;
const loginIdentifier = process.env.E2E_LOGIN_IDENTIFIER;
const password = process.env.E2E_PASSWORD;

const seeded = Boolean(tenantId && loginIdentifier && password);

test.describe("admin roles CRUD (authenticated)", () => {
  test.skip(
    !seeded,
    "requires a seeded tenant — CI e2e-smoke provisions one via POST /api/v1/setup/initialize"
  );

  test("owner creates a role and sees the new row + action controls", async ({
    page
  }) => {
    await page.goto("/login");
    await provideTenant(page, tenantId!);
    await page.locator("#login-identifier").fill(loginIdentifier!);
    await page.locator("#password").fill(password!);
    await page.locator("#login-submit").click();

    // The client script redirects to /admin on success.
    await page.waitForURL("**/admin");

    await page.goto("/admin/roles");

    // The owner holds `access_control.configure`, so the form renders.
    const form = page.locator("#role-create-form");
    await expect(form).toBeVisible();

    // A per-run unique code so re-running the suite doesn't collide on the
    // `(tenant_id, role_code)` uniqueness constraint.
    const newCode = `qa-e2e-${Date.now()}`;

    await page.locator("#role-code").fill(newCode);
    await page.locator("#role-name").fill("E2E Role");
    await page.locator("#role-create-submit").click();

    // The client reloads the page on success; wait for the SSR table to
    // re-render with the new row.
    const table = page.locator("#roles-table");
    await expect(table).toBeVisible();
    await expect(table).toContainText(newCode);
    await expect(page.locator("#role-create-error")).toBeHidden();

    // The new (custom) role's row exposes rename + delete + manage-permissions.
    const row = table.locator("tr", { hasText: newCode });
    await expect(
      row.locator("button[data-role-action='rename']")
    ).toBeVisible();
    await expect(
      row.locator("button[data-role-action='delete']")
    ).toBeVisible();
    await expect(row.locator("details.role-permissions")).toBeVisible();
  });

  /**
   * PROJECT_STATE §4 **C6** — the permission catalogue is sent ONCE, in a
   * `<template>`, and cloned into a role's picker when that role's panel is
   * opened. The exclusion of already-granted permissions moved from the server
   * to that clone, so it needs cross-layer proof: source assertions
   * (`admin-roles-page-payload.test.ts`) can show the template exists and the
   * per-role loop is gone, but only a browser can show that the picker ends up
   * holding the right options — and, after a grant, one fewer.
   */
  test("the grant picker fills from the shared catalogue and drops what is granted", async ({
    page
  }) => {
    await page.goto("/login");
    await provideTenant(page, tenantId!);
    await page.locator("#login-identifier").fill(loginIdentifier!);
    await page.locator("#password").fill(password!);
    await page.locator("#login-submit").click();
    await page.waitForURL("**/admin");

    await page.goto("/admin/roles");

    const newCode = `qa-e2e-grant-${Date.now()}`;
    await page.locator("#role-code").fill(newCode);
    await page.locator("#role-name").fill("E2E Grant Role");
    await page.locator("#role-create-submit").click();

    const table = page.locator("#roles-table");
    await expect(table).toContainText(newCode);

    // The catalogue is in the document exactly once, whatever the role count.
    await expect(page.locator("#permission-catalog-options")).toHaveCount(1);

    // Everything below is scoped to THIS role's row. The seeded tenant has
    // several roles, and the permission granted here is one the owner role
    // already holds — a page-wide `[data-permission-id=…]` matches all of
    // them, which is a strict-mode violation rather than a useful assertion.
    const roleRow = () => table.locator("tr", { hasText: newCode });

    const openPanel = async () => {
      const panel = roleRow().locator("details.role-permissions");
      await panel.locator("summary").click();
      return panel;
    };

    let panel = await openPanel();
    const select = panel.locator("select[data-role-grant-select]");

    // Empty until the panel is opened; filled from the template on open.
    await expect(select.locator("option").first()).toBeAttached();
    const optionsBefore = await select.locator("option").count();
    expect(optionsBefore).toBeGreaterThan(0);

    const grantedId = await select
      .locator("option")
      .first()
      .getAttribute("value");
    expect(grantedId).toBeTruthy();

    await select.selectOption(grantedId!);
    await panel
      .locator("form[data-role-grant-form] button[type='submit']")
      .click();

    // The client reloads on success. Wait on THIS ROW's grant rather than on
    // the row itself — the row is already on screen, so waiting for it would
    // pass against the pre-reload DOM and race the navigation. The revoke
    // button exists only in the re-rendered page (attached, though its panel
    // starts collapsed).
    await expect(
      roleRow().locator(`button[data-permission-id="${grantedId}"]`)
    ).toBeAttached();

    panel = await openPanel();
    await expect(
      panel.locator(`button[data-permission-id="${grantedId}"]`)
    ).toBeVisible();

    // ...and the picker no longer offers it.
    const selectAfter = panel.locator("select[data-role-grant-select]");
    await expect(selectAfter.locator("option").first()).toBeAttached();
    await expect(
      selectAfter.locator(`option[value="${grantedId}"]`)
    ).toHaveCount(0);
    expect(await selectAfter.locator("option").count()).toBe(optionsBefore - 1);
  });
});
