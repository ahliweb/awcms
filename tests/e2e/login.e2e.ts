/**
 * Login page render spec (Issue #166) — see skill `awcms-browser-test`.
 *
 * The auto tenant picker (UI/UX phase 2) makes `/login` do ONE best-effort,
 * read-only SSR read of the active tenant registry to choose the tenant field
 * shape. That read is wrapped so any failure (a placeholder `DATABASE_URL` that
 * never connects, an unmigrated DB, an empty registry) degrades to the manual
 * `#tenant-id` TEXT input — so this spec still needs zero seeded data and
 * `#tenant-id` is still a visible field here (the "pick a target that needs no
 * fixtures" convention, skill #4). It proves the first `.astro` page renders in
 * a real browser AND that its client script executes under the middleware CSP
 * (`default-src 'self'`): if Astro had inlined the script, CSP would block it
 * and the form's stable ids would still be present but dead — so a follow-up
 * render assertion is not enough on its own; the submit-behaviour path is
 * covered by `admin-offices.e2e.ts` where a seeded session exists.
 *
 * Run: `bun run build && bun run start` (DATABASE_URL may be a placeholder —
 * the tenant read then fails closed to the manual field), then
 * `bun run test:e2e`.
 */
import { test, expect } from "@playwright/test";

test.describe("login page", () => {
  test("renders the login form with its stable fields", async ({ page }) => {
    const response = await page.goto("/login");

    expect(response?.status()).toBe(200);
    await expect(page.locator("#login-form")).toBeVisible();
    await expect(page.locator("#tenant-id")).toBeVisible();
    await expect(page.locator("#login-identifier")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();
    await expect(page.locator("#login-submit")).toBeVisible();
    await expect(page.locator("#login-error")).toBeHidden();
  });

  test("the page ships no inline script (CSP: default-src 'self') — its behaviour comes from an external bundle", async ({
    page
  }) => {
    await page.goto("/login");

    // Every <script> the page loaded must be external (has a src) — an inline
    // one would have been blocked by CSP, so asserting "no inline script"
    // doubles as asserting the login behaviour can actually run.
    const inlineScripts = await page.$$eval(
      "script",
      (nodes) =>
        nodes.filter((n) => !n.getAttribute("src") && n.textContent?.trim())
          .length
    );
    expect(inlineScripts).toBe(0);

    const scriptSrcs = await page.$$eval("script[src]", (nodes) =>
      nodes.map((n) => n.getAttribute("src"))
    );
    expect(scriptSrcs.some((s) => s?.startsWith("/_astro/"))).toBe(true);
  });
});
