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
});
