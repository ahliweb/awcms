/**
 * Authenticated admin management E2E (Issue #166) — the full loop: log in
 * through the real `/login` form → session cookies → `/admin` guard → SSR
 * render of the offices management screen backed by `listOffices`.
 *
 * Needs a seeded tenant + owner, which the CI `e2e-smoke` job provisions ONCE
 * via `POST /api/v1/setup/initialize` (the real bootstrap — no bespoke seed
 * SQL) and hands to this spec through env vars. Skipped (not failed) when they
 * are absent, so a local `bun run test:e2e` without a seeded DB stays green —
 * the same "provide the environment" convention the DB-gated `bun:test`
 * integration suite uses. The seeded owner role holds every permission, so the
 * `office_management.read` gate on the page passes and the bootstrap's
 * `head_office` row is what the table must show.
 */
import { test, expect } from "@playwright/test";

const tenantId = process.env.E2E_TENANT_ID;
const loginIdentifier = process.env.E2E_LOGIN_IDENTIFIER;
const password = process.env.E2E_PASSWORD;
const officeCode = process.env.E2E_OFFICE_CODE;

const seeded = Boolean(tenantId && loginIdentifier && password && officeCode);

test.describe("admin offices (authenticated)", () => {
  test.skip(
    !seeded,
    "requires a seeded tenant — CI e2e-smoke provisions one via POST /api/v1/setup/initialize"
  );

  test("logs in, lands on the dashboard, and sees the seeded office", async ({
    page
  }) => {
    await page.goto("/login");
    await page.locator("#tenant-id").fill(tenantId!);
    await page.locator("#login-identifier").fill(loginIdentifier!);
    await page.locator("#password").fill(password!);
    await page.locator("#login-submit").click();

    // The client script redirects to /admin on success.
    await page.waitForURL("**/admin");
    await expect(page.locator("#admin-dashboard-heading")).toBeVisible();
    await expect(page.locator("#dashboard-tenant-id")).toHaveText(tenantId!);

    await page.goto("/admin/offices");
    const table = page.locator("#offices-table");
    await expect(table).toBeVisible();
    // The bootstrap created exactly one office (head_office) with this code.
    await expect(table).toContainText(officeCode!);
    await expect(page.locator("#offices-denied")).toHaveCount(0);
  });

  test("the other management screens render their tables for the owner", async ({
    page
  }) => {
    // Log in first (fresh page/context per test).
    await page.goto("/login");
    await page.locator("#tenant-id").fill(tenantId!);
    await page.locator("#login-identifier").fill(loginIdentifier!);
    await page.locator("#password").fill(password!);
    await page.locator("#login-submit").click();
    await page.waitForURL("**/admin");

    // Modules: the catalog always lists the code-registered core modules, so
    // this is data-seed-free — assert a known core module appears.
    await page.goto("/admin/modules");
    await expect(page.locator("#modules-table")).toBeVisible();
    await expect(page.locator("#modules-table")).toContainText(
      "module_management"
    );

    // Email templates + profiles: the owner has the permission, so the table
    // (possibly empty) renders rather than the "no access" notice.
    await page.goto("/admin/email-templates");
    await expect(page.locator("#email-templates-table")).toBeVisible();
    await expect(page.locator("#email-templates-denied")).toHaveCount(0);

    await page.goto("/admin/profiles");
    await expect(page.locator("#profiles-table")).toBeVisible();
    await expect(page.locator("#profiles-denied")).toHaveCount(0);
  });

  test("rejects a wrong password with a generic error, not a stack trace", async ({
    page
  }) => {
    await page.goto("/login");
    await page.locator("#tenant-id").fill(tenantId!);
    await page.locator("#login-identifier").fill(loginIdentifier!);
    await page.locator("#password").fill("definitely-the-wrong-password");
    await page.locator("#login-submit").click();

    const error = page.locator("#login-error");
    await expect(error).toBeVisible();

    const text = ((await error.textContent()) ?? "").toLowerCase();
    expect(text.length).toBeGreaterThan(0);
    for (const marker of ["stack", "postgres", "at object", "invalid"]) {
      expect(text).not.toContain(marker);
    }
    // Still on /login — no session was minted.
    await expect(page).toHaveURL(/\/login$/);
  });
});
