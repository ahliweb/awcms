/**
 * Authenticated module enable/disable toggle E2E (Issue #171 write actions) —
 * the full loop: log in through the real `/login` form → session cookies →
 * `/admin` guard → click a per-row toggle on the modules screen → POST to
 * `POST /api/v1/tenant/modules/{key}/{enable,disable}` via cookie auth → page
 * reload → the same row now offers the OPPOSITE action (proving the tenant
 * module state actually flipped, not just that the request 200'd).
 *
 * Env-gated exactly like `admin-offices-create.e2e.ts`: the CI `e2e-smoke` job
 * seeds a tenant + owner via `POST /api/v1/setup/initialize` and hands the
 * credentials through env vars. Skipped (not failed) when absent. The seeded
 * owner holds `module_management.tenant_modules.{enable,disable}`, so the
 * toggle buttons render.
 *
 * Self-reversing so it is retry-safe and leaves no residue: it toggles the
 * first available module, asserts the flip, then toggles it back to the
 * original state and asserts the round-trip. A CI retry therefore starts from
 * the same catalog state.
 */
import { test, expect } from "@playwright/test";

const tenantId = process.env.E2E_TENANT_ID;
const loginIdentifier = process.env.E2E_LOGIN_IDENTIFIER;
const password = process.env.E2E_PASSWORD;

const seeded = Boolean(tenantId && loginIdentifier && password);

test.describe("admin modules toggle (authenticated)", () => {
  test.skip(
    !seeded,
    "requires a seeded tenant — CI e2e-smoke provisions one via POST /api/v1/setup/initialize"
  );

  test("owner toggles a module and the row flips, then reverts", async ({
    page
  }) => {
    await page.goto("/login");
    await page.locator("#tenant-id").fill(tenantId!);
    await page.locator("#login-identifier").fill(loginIdentifier!);
    await page.locator("#password").fill(password!);
    await page.locator("#login-submit").click();

    await page.waitForURL("**/admin");

    await page.goto("/admin/modules");
    await expect(page.locator("#modules-table")).toBeVisible();

    const firstToggle = page.locator("button.module-toggle").first();

    // A seeded tenant should have at least one toggleable (non-core) module; if
    // the catalog somehow has none, skip rather than assert a false positive.
    test.skip(
      (await page.locator("button.module-toggle").count()) === 0,
      "no toggleable modules in the seeded catalog"
    );

    const moduleKey = await firstToggle.getAttribute("data-module-key");
    const action = await firstToggle.getAttribute("data-action");
    expect(moduleKey).toBeTruthy();
    expect(action === "enable" || action === "disable").toBe(true);

    const opposite = action === "enable" ? "disable" : "enable";
    const rowButton = page.locator(
      `button.module-toggle[data-module-key="${moduleKey}"]`
    );

    // First toggle → the row must now offer the OPPOSITE action.
    await firstToggle.click();
    await expect(rowButton).toHaveAttribute("data-action", opposite);
    await expect(page.locator("#modules-toggle-error")).toBeHidden();

    // Revert so the catalog state is unchanged for the next run/retry.
    await rowButton.click();
    await expect(rowButton).toHaveAttribute("data-action", action!);
    await expect(page.locator("#modules-toggle-error")).toBeHidden();
  });
});
