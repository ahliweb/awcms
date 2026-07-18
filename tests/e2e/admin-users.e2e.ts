/**
 * Authenticated admin write-action E2E (Issue #171) — exercises the
 * permission-gated write controls on `/admin/users`: log in through the real
 * `/login` form → session cookies → `/admin` guard → the Users screen renders
 * the activate/deactivate + role-assignment controls (the seeded owner holds
 * `identity_access.access_control.configure` and `.assign`) → a role-assign
 * round-trips through `POST /api/v1/access/assignments` via cookie auth.
 *
 * Env-gated exactly like `admin-offices-create.e2e.ts`: the CI `e2e-smoke` job
 * seeds a tenant + owner via `POST /api/v1/setup/initialize` and hands the
 * credentials through env vars. Skipped (not failed) when they are absent.
 *
 * The single seeded user is the owner, who already holds the only role, so the
 * assertion is deliberately non-destructive: re-assigning the already-held role
 * is rejected (409) and the client surfaces the generic error — proving the
 * external CSP-safe script, `sendJson`, and the guarded endpoint all round-trip
 * without deactivating the owner (which would revoke the running session).
 */
import { test, expect } from "@playwright/test";

const tenantId = process.env.E2E_TENANT_ID;
const loginIdentifier = process.env.E2E_LOGIN_IDENTIFIER;
const password = process.env.E2E_PASSWORD;

const seeded = Boolean(tenantId && loginIdentifier && password);

test.describe("admin users write controls (authenticated)", () => {
  test.skip(
    !seeded,
    "requires a seeded tenant — CI e2e-smoke provisions one via POST /api/v1/setup/initialize"
  );

  test("owner sees the write controls and a duplicate assign is rejected", async ({
    page
  }) => {
    await page.goto("/login");
    await page.locator("#tenant-id").fill(tenantId!);
    await page.locator("#login-identifier").fill(loginIdentifier!);
    await page.locator("#password").fill(password!);
    await page.locator("#login-submit").click();

    await page.waitForURL("**/admin");
    await page.goto("/admin/users");

    // The owner holds read + configure + assign, so the table and its Actions
    // column render.
    const table = page.locator("#users-table");
    await expect(table).toBeVisible();

    // Deactivate control renders for the active owner (configure gate).
    await expect(page.locator(".js-user-status").first()).toBeVisible();

    // Assign the already-held role → 409 → the client shows the generic error.
    const assignButton = page.locator(".js-assign-role").first();
    await expect(assignButton).toBeVisible();
    await assignButton.click();

    await expect(page.locator("#users-action-error")).toBeVisible();
  });
});
