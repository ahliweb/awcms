/**
 * `/login` second-factor step (Issue #1365) — see skill `awcms-browser-test`.
 *
 * Both API answers are FULFILLED by the spec (`401 MFA_REQUIRED`, then the
 * verify answer), so no real session is minted and no factor is seeded — which
 * is why it belongs in the READ wave. What is asserted is the page's behaviour:
 * the code step appears, focus moves to the code input, a wrong code retries
 * without leaving the step, a right code posts the token + code, the recovery
 * code alternative posts `recoveryCode`, "back" returns to the password step,
 * the token is never in the URL/DOM/storage, and nothing scrolls sideways at
 * 360 px.
 */
import { test, expect, type Page } from "./support/e2e-read-wave";

test.use({ storageState: { cookies: [], origins: [] } });

const TOKEN = "challenge-token-abc123";

async function openMfaStep(
  page: Page,
  verify: (body: Record<string, unknown>) => {
    status: number;
    success: boolean;
  }
): Promise<Record<string, unknown>[]> {
  const verifyBodies: Record<string, unknown>[] = [];

  await page.route("**/api/v1/auth/login", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        success: false,
        error: {
          code: "MFA_REQUIRED",
          message: "x",
          details: { mfaChallengeToken: TOKEN }
        },
        meta: {}
      })
    })
  );
  await page.route("**/api/v1/auth/mfa/totp/verify", (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    verifyBodies.push(body);
    const answer = verify(body);
    return route.fulfill({
      status: answer.status,
      contentType: "application/json",
      body: JSON.stringify(
        answer.success
          ? { success: true, data: {} }
          : { success: false, error: { code: "MFA_CHALLENGE_INVALID" } }
      )
    });
  });
  // The success path navigates to /admin; keep it from hitting the server.
  await page.route("**/admin", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "admin" })
  );

  await page.goto("/login");
  const tenant = page.locator("#tenant-id");
  const type = await tenant.getAttribute("type");
  const tag = await tenant.evaluate((el) => el.tagName.toLowerCase());
  if (tag !== "select" && type !== "hidden") {
    await tenant.fill("00000000-0000-0000-0000-000000000000");
  }
  await page.locator("#login-identifier").fill("someone@example.test");
  await page.locator("#password").fill("a-correct-password-1234");
  await page.locator("#login-submit").click();

  await expect(page.locator("#mfa-form")).toBeVisible();
  await expect(page.locator("#login-form")).toBeHidden();
  return verifyBodies;
}

test.describe("login: second-factor step", () => {
  test("wrong code retries, right code posts token + code and leaves for /admin", async ({
    page
  }) => {
    const bodies = await openMfaStep(page, (body) =>
      body.code === "123456"
        ? { status: 200, success: true }
        : { status: 401, success: false }
    );

    const code = page.locator("#mfa-code");
    await expect(code).toBeFocused();
    await expect(code).toHaveAttribute("autocomplete", "one-time-code");
    await expect(code).toHaveAttribute("inputmode", "numeric");

    // The token is nowhere in the URL, the DOM, or storage.
    expect(page.url()).not.toContain(TOKEN);
    expect(await page.content()).not.toContain(TOKEN);
    expect(
      await page.evaluate(
        () => JSON.stringify(localStorage) + JSON.stringify(sessionStorage)
      )
    ).not.toContain(TOKEN);

    await code.fill("000000");
    await page.locator("#mfa-submit").click();
    await expect(page.locator("#mfa-error")).toBeVisible();
    await expect(page.locator("#mfa-form")).toBeVisible();

    await code.fill("123 456");
    await page.locator("#mfa-submit").click();
    await page.waitForURL("**/admin");

    expect(bodies).toEqual([
      { mfaChallengeToken: TOKEN, code: "000000" },
      { mfaChallengeToken: TOKEN, code: "123456" }
    ]);
  });

  test("recovery code alternative posts recoveryCode", async ({ page }) => {
    const bodies = await openMfaStep(page, () => ({
      status: 200,
      success: true
    }));

    await page.locator("#mfa-toggle").click();
    await expect(page.locator("#mfa-code")).toHaveAttribute(
      "autocomplete",
      "off"
    );
    await page.locator("#mfa-code").fill("ABCD-EFGH-1234");
    await page.locator("#mfa-submit").click();
    await page.waitForURL("**/admin");

    expect(bodies).toEqual([
      { mfaChallengeToken: TOKEN, recoveryCode: "ABCD-EFGH-1234" }
    ]);
  });

  test("back returns to the password step, and the attempt cap does too", async ({
    page
  }) => {
    await openMfaStep(page, () => ({ status: 401, success: false }));

    await page.locator("#mfa-back").click();
    await expect(page.locator("#login-form")).toBeVisible();
    await expect(page.locator("#mfa-form")).toBeHidden();

    await page.locator("#password").fill("a-correct-password-1234");
    await page.locator("#login-submit").click();
    await expect(page.locator("#mfa-form")).toBeVisible();

    // The page's attempt budget comes from server config (default 5).
    const max = Number(
      await page.locator("#login-form").getAttribute("data-mfa-max-attempts")
    );
    for (let i = 0; i < max; i++) {
      await page.locator("#mfa-code").fill("000000");
      await page.locator("#mfa-submit").click();
      if (i < max - 1) await expect(page.locator("#mfa-error")).toBeVisible();
    }
    await expect(page.locator("#login-form")).toBeVisible();
    await expect(page.locator("#login-error")).toBeVisible();
    await expect(page.locator("#mfa-form")).toBeHidden();
  });

  test("no sideways scroll at 360px", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await openMfaStep(page, () => ({ status: 401, success: false }));
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth
    );
    expect(overflow).toBe(false);
  });
});
