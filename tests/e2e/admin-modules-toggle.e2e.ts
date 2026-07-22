/**
 * Authenticated module enable/disable toggle E2E (Issue #171 write actions) —
 * the full loop: log in through the real `/login` form → session cookies →
 * `/admin` guard → click a per-row toggle on the modules screen → POST to
 * `POST /api/v1/tenant/modules/{key}/{enable,disable}` via cookie auth → page
 * reload → the same row now offers the OPPOSITE action (proving the tenant
 * module enablement state — `awcms_tenant_modules.enabled`, what the screen
 * renders — actually flipped, not just that the request 200'd).
 *
 * Env-gated exactly like `admin-offices-create.e2e.ts`: the CI `e2e-smoke` job
 * seeds a tenant + owner via `POST /api/v1/setup/initialize` and hands the
 * credentials through env vars. Skipped (not failed) when absent. The seeded
 * owner holds `module_management.tenant_modules.{enable,disable}`, so the
 * toggle buttons render.
 *
 * Targets `reporting` deliberately: it is a non-core LEAF module (declares no
 * dependencies and nothing depends on it), so a disable is never rejected by
 * the endpoint's dependency guard — unlike `logging`, which other modules
 * depend on and cannot be disabled. Every module defaults to
 * `tenantEnabled: true` on a fresh seed, so `reporting` starts enabled
 * (data-action="disable").
 *
 * Self-reversing so it is retry-safe and leaves no residue: disable → assert
 * flip → enable back → assert the round-trip. A CI retry therefore starts from
 * the same catalog state.
 */
import { test, expect } from "@playwright/test";
import { provideTenant } from "./support/e2e-auth";

const tenantId = process.env.E2E_TENANT_ID;
const loginIdentifier = process.env.E2E_LOGIN_IDENTIFIER;
const password = process.env.E2E_PASSWORD;

const seeded = Boolean(tenantId && loginIdentifier && password);

// A non-core leaf module (no dependencies, no dependents) so disable is never
// dependency-blocked, and it round-trips cleanly.
const moduleKey = "reporting";

test.describe("admin modules toggle (authenticated)", () => {
  test.skip(
    !seeded,
    "requires a seeded tenant — CI e2e-smoke provisions one via POST /api/v1/setup/initialize"
  );

  test("owner disables a leaf module and the row flips, then reverts", async ({
    page
  }) => {
    // Disabling a module prompts for a `reason` (the endpoint requires a
    // non-empty one, recorded in the audit event) — accept every prompt with a
    // fixed reason so the disable branch goes through.
    page.on("dialog", (dialog) => dialog.accept("E2E toggle round-trip"));

    await page.goto("/login");
    await provideTenant(page, tenantId!);
    await page.locator("#login-identifier").fill(loginIdentifier!);
    await page.locator("#password").fill(password!);
    await page.locator("#login-submit").click();

    await page.waitForURL("**/admin");

    await page.goto("/admin/modules");
    await expect(page.locator("#modules-table")).toBeVisible();

    const rowButton = page.locator(
      `button.module-toggle[data-module-key="${moduleKey}"]`
    );

    // Fresh seed → `reporting` is enabled, so its button disables it.
    await expect(rowButton).toHaveAttribute("data-action", "disable");

    // Disable → the row must now offer the OPPOSITE (enable) action, and no
    // error surfaced (proving the tenant-enablement state actually flipped).
    await rowButton.click();
    await expect(rowButton).toHaveAttribute("data-action", "enable");
    await expect(page.locator("#modules-toggle-error")).toBeHidden();

    // Revert so the catalog state is unchanged for the next run/retry.
    await rowButton.click();
    await expect(rowButton).toHaveAttribute("data-action", "disable");
    await expect(page.locator("#modules-toggle-error")).toBeHidden();
  });
});
