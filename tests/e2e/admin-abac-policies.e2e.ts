/**
 * Authenticated admin write-action E2E (Issue #171) — exercises the
 * permission-gated create + toggle controls on `/admin/abac-policies`: log in
 * through the real `/login` form → session cookies → `/admin` guard → fill the
 * create-policy form → `POST /api/v1/abac/policies` via cookie auth → page
 * reload → the new row appears in the SSR-rendered `#abac-policies-table` → then
 * disable it via `PATCH /api/v1/abac/policies/{id}` and confirm the state flips.
 *
 * Env-gated exactly like `admin-offices-create.e2e.ts`: the CI `e2e-smoke` job
 * seeds a tenant + owner via `POST /api/v1/setup/initialize` and hands the
 * credentials through env vars. Skipped (not failed) when they are absent, so a
 * local `bun run test:e2e` without a seeded DB stays green. The seeded owner
 * role holds every permission, so the `access_control.{create,update}` gates
 * pass and the controls render.
 */
import { test, expect } from "@playwright/test";

const tenantId = process.env.E2E_TENANT_ID;
const loginIdentifier = process.env.E2E_LOGIN_IDENTIFIER;
const password = process.env.E2E_PASSWORD;

const seeded = Boolean(tenantId && loginIdentifier && password);

test.describe("admin ABAC policies write (authenticated)", () => {
  test.skip(
    !seeded,
    "requires a seeded tenant — CI e2e-smoke provisions one via POST /api/v1/setup/initialize"
  );

  test("owner creates a policy, sees the row, then disables it", async ({
    page
  }) => {
    await page.goto("/login");
    await page.locator("#tenant-id").fill(tenantId!);
    await page.locator("#login-identifier").fill(loginIdentifier!);
    await page.locator("#password").fill(password!);
    await page.locator("#login-submit").click();

    // The client script redirects to /admin on success.
    await page.waitForURL("**/admin");

    await page.goto("/admin/abac-policies");

    // The owner holds `access_control.create`, so the form renders.
    const form = page.locator("#policy-create-form");
    await expect(form).toBeVisible();

    // A per-run unique code so re-running the suite doesn't collide on the
    // `(tenant_id, policy_code)` uniqueness constraint.
    const newCode = `e2e.policy.${Date.now()}`;

    await page.locator("#policy-code").fill(newCode);
    await page.locator("#policy-effect").selectOption("deny");
    await page.locator("#policy-description").fill("E2E authored policy");
    await page.locator("#policy-create-submit").click();

    // The client reloads the page on success; wait for the SSR table to
    // re-render with the new row.
    const table = page.locator("#abac-policies-table");
    await expect(table).toBeVisible();
    await expect(table).toContainText(newCode);
    await expect(page.locator("#policy-create-error")).toBeHidden();

    // The new row is active, so its toggle offers "Disable". Click it and
    // confirm the row's Active cell flips to "no" after the reload.
    const newRow = page.locator("#abac-policies-table tbody tr", {
      hasText: newCode
    });
    const toggle = newRow.locator("button.policy-toggle");
    await expect(toggle).toHaveText("Disable");

    // The toggle triggers a full reload; re-resolve the row afterwards.
    await Promise.all([page.waitForLoadState("load"), toggle.click()]);

    const reloadedRow = page.locator("#abac-policies-table tbody tr", {
      hasText: newCode
    });
    await expect(reloadedRow.locator("button.policy-toggle")).toHaveText(
      "Enable"
    );
  });
});
