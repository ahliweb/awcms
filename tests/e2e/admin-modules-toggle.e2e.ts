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
 * `tenantEnabled: true` on a fresh seed, so `reporting` starts with a Disable
 * button rendered.
 *
 * Disable goes through `ReasonPanel` (Issue #854 part 3), not
 * `window.prompt()` — this test fills its textarea and clicks its submit
 * button rather than intercepting a native `dialog` event, which is also
 * this file's coverage of the reason-panel fetch-mode submit path end to end
 * (open → type → submit → reload → row flips).
 *
 * Self-reversing so it is retry-safe and leaves no residue: disable → assert
 * flip → enable back → assert the round-trip. A CI retry therefore starts from
 * the same catalog state.
 */
import { test, expect } from "@playwright/test";

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
    // Already authenticated as the owner: the `setup` project logged in once
    // and this project reuses that session. See `tests/e2e/auth.setup.ts`.

    await page.goto("/admin/modules");
    await expect(page.locator("#modules-table")).toBeVisible();

    const enableButton = page.locator(
      `button.module-toggle[data-module-key="${moduleKey}"][data-action="enable"]`
    );
    // Disabling a module (Issue #854 part 3) is a `ReasonPanel`, not
    // `window.prompt()` — identified by the same disable URL its
    // `data-reason-action` carries, which is the one attribute this button
    // still exposes now that `data-module-key`/`data-action` moved to the
    // (unaffected) Enable button.
    const disableButton = page.locator(
      `button[data-reason-action="/api/v1/tenant/modules/${moduleKey}/disable"]`
    );

    // Fresh seed → `reporting` is enabled, so its Disable button is present.
    await expect(disableButton).toBeVisible();

    // Disable via the reason panel: open it, fill the required reason, submit.
    await disableButton.click();
    const panel = page.locator("#admin-reason-panel");
    await expect(panel).toBeVisible();
    await panel
      .locator("[data-reason-panel-textarea]")
      .fill("E2E toggle round-trip");
    await panel.locator("[data-reason-panel-submit]").click();

    // The row must now offer the OPPOSITE (enable) action, and no error
    // surfaced (proving the tenant-enablement state actually flipped).
    await expect(enableButton).toBeVisible();
    await expect(page.locator("#modules-toggle-error")).toBeHidden();

    // Revert so the catalog state is unchanged for the next run/retry. Enable
    // takes no reason — same plain click-and-reload flow as before.
    await enableButton.click();
    await expect(disableButton).toBeVisible();
    await expect(page.locator("#modules-toggle-error")).toBeHidden();
  });
});
