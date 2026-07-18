/**
 * Authenticated create-profile E2E (Issue #166 write actions) — the full loop:
 * log in through the real `/login` form → session cookies → `/admin` guard →
 * the create form on the profiles screen POSTs to `POST /api/v1/profiles` via
 * cookie auth, then the reloaded table shows the new row.
 *
 * Env-gated exactly like `admin-offices.e2e.ts`: the CI `e2e-smoke` job seeds a
 * tenant + owner once via `POST /api/v1/setup/initialize` and hands them here
 * through env vars. Skipped (not failed) when absent so a local
 * `bun run test:e2e` without a seeded DB stays green. The seeded owner holds
 * every permission, so the `profile_identity.profile_management.create` gate on
 * the form passes.
 */
import { test, expect } from "@playwright/test";

const tenantId = process.env.E2E_TENANT_ID;
const loginIdentifier = process.env.E2E_LOGIN_IDENTIFIER;
const password = process.env.E2E_PASSWORD;

const seeded = Boolean(tenantId && loginIdentifier && password);

test.describe("admin profiles create (authenticated)", () => {
  test.skip(
    !seeded,
    "requires a seeded tenant — CI e2e-smoke provisions one via POST /api/v1/setup/initialize"
  );

  test("owner creates a profile and sees the new row in the table", async ({
    page
  }) => {
    await page.goto("/login");
    await page.locator("#tenant-id").fill(tenantId!);
    await page.locator("#login-identifier").fill(loginIdentifier!);
    await page.locator("#password").fill(password!);
    await page.locator("#login-submit").click();

    // The client script redirects to /admin on success.
    await page.waitForURL("**/admin");

    await page.goto("/admin/profiles");

    // The owner holds the create permission, so the form renders.
    await expect(page.locator("#profile-create-form")).toBeVisible();

    // Per-run unique name — a fixed name would let a leftover row from a prior
    // run (or a retry) pass the `toContainText` check even if THIS run's create
    // silently failed (a false green). Same discipline as the offices spec.
    const displayName = `E2E Person ${Date.now()}`;
    await page.locator("#profile-type").selectOption("person");
    await page.locator("#profile-display-name").fill(displayName);
    await page.locator("#profile-create-submit").click();

    // On success the client reloads; the reloaded SSR table now lists the row,
    // and the error box stays hidden (proves the create actually succeeded).
    const table = page.locator("#profiles-table");
    await expect(table).toBeVisible();
    await expect(table).toContainText(displayName);
    await expect(page.locator("#profile-create-error")).toBeHidden();
  });
});
