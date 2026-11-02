/**
 * Double submit on the login form (Issue #1224) — see skill
 * `awcms-browser-test` and `docs/awcms/ui-single-flight-audit.md`.
 *
 * `/login` is a PUBLIC form bound through the shared `onSubmit` guard. Two
 * properties are asserted, and the second is the one a naive "disable the
 * button forever" implementation breaks:
 *
 * 1. A double click and an Enter press while the request is pending send ONE
 *    `POST /api/v1/auth/login`.
 * 2. After a refused attempt the lock is released, so the person (or a
 *    Turnstile / MFA retry) can submit again, and that second attempt is sent.
 *
 * The login request is FULFILLED by the test (a delayed 401), so no real
 * session is minted and nothing about the seeded tenant is touched — which is
 * why this belongs in the READ wave, whose fixture still watches for any other
 * mutating request. It needs no seeded tenant: the form renders and posts the
 * same way whatever the tenant picker shows.
 */
import { test, expect } from "./support/e2e-read-wave";

// Start logged OUT, like `login.e2e.ts`.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("login: double submit", () => {
  test("a double click and an Enter send one request, and a refused attempt can be retried", async ({
    page
  }) => {
    const attempts: string[] = [];

    await page.route("**/api/v1/auth/login", async (route) => {
      attempts.push(route.request().method());
      // Long enough that the second click and the Enter arrive while this one
      // is pending; short enough not to slow the suite.
      await new Promise((done) => setTimeout(done, 600));
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          error: { code: "INVALID_CREDENTIALS" }
        })
      });
    });

    await page.goto("/login");

    // The tenant field is hidden+prefilled with one tenant, a select with
    // several, or a text input with none; only the last needs a value here.
    const tenant = page.locator("#tenant-id");
    const type = await tenant.getAttribute("type");
    const tag = await tenant.evaluate((el) => el.tagName.toLowerCase());
    if (tag !== "select" && type !== "hidden") {
      await tenant.fill("00000000-0000-0000-0000-000000000000");
    }

    await page.locator("#login-identifier").fill("nobody@example.test");
    await page.locator("#password").fill("not-the-password-1234");

    const submit = page.locator("#login-submit");
    const form = page.locator("#login-form");

    await submit.dblclick();
    await page.locator("#password").press("Enter");

    // Pending: busy form, disabled submit.
    await expect(form).toHaveAttribute("aria-busy", "true");
    await expect(submit).toBeDisabled();

    // Settled with a refusal: the generic message shows, the lock is released.
    await expect(page.locator("#login-error")).toBeVisible();
    await expect(submit).toBeEnabled();
    await expect(form).not.toHaveAttribute("aria-busy", "true");
    expect(attempts).toHaveLength(1);

    // The retry path (what a Turnstile or MFA retry relies on) still works.
    await submit.click();
    await expect(page.locator("#login-error")).toBeVisible();
    await expect.poll(() => attempts.length).toBe(2);
    await expect(submit).toBeEnabled();
  });
});
