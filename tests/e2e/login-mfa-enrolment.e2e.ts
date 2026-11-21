/**
 * `/login` pre-session enrolment step (Issue #1425) — see skill
 * `awcms-browser-test`.
 *
 * Every API answer is FULFILLED by the spec (`401 MFA_ENROLLMENT_REQUIRED`,
 * then `enroll/start` and `enroll/verify`), so no real session is minted and no
 * factor is seeded — which is why it belongs in the READ wave. What is asserted
 * is the page's behaviour: the step appears with a local QR and the manual key,
 * the grant travels only in the request header, a wrong code retries, a right
 * code shows the recovery codes once and "continue" leaves for /admin, a
 * refused start returns to the password step, and the grant and the secret are
 * nowhere in the URL, storage or DOM beyond the QR and the key.
 */
import { test, expect, type Page } from "./support/e2e-read-wave";

test.use({ storageState: { cookies: [], origins: [] } });

const GRANT = "enrolment-grant-abc123";
const SECRET = "JBSWY3DPEHPK3PXP";
const URI = `otpauth://totp/AWCMS:user%40example.test?secret=${SECRET}&issuer=AWCMS`;

type Seen = {
  startHeaders: Record<string, string>[];
  verifyHeaders: Record<string, string>[];
  verifyBodies: Record<string, unknown>[];
};

async function openEnrolStep(
  page: Page,
  options: {
    startOk?: boolean;
    verify?: (body: Record<string, unknown>) => boolean;
  } = {}
): Promise<Seen> {
  const seen: Seen = { startHeaders: [], verifyHeaders: [], verifyBodies: [] };
  const startOk = options.startOk ?? true;
  const verify = options.verify ?? (() => true);

  await page.route("**/api/v1/auth/login", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        success: false,
        error: {
          code: "MFA_ENROLLMENT_REQUIRED",
          message: "x",
          details: {
            mfaEnrollmentToken: GRANT,
            expiresAt: "2099-01-01T00:00:00.000Z"
          }
        },
        meta: {}
      })
    })
  );
  await page.route("**/api/v1/auth/mfa/totp/enroll/start", (route) => {
    seen.startHeaders.push(route.request().headers());
    return route.fulfill({
      status: startOk ? 200 : 401,
      contentType: "application/json",
      body: JSON.stringify(
        startOk
          ? { success: true, data: { secret: SECRET, otpauthUri: URI } }
          : { success: false, error: { code: "AUTH_REQUIRED" } }
      )
    });
  });
  await page.route("**/api/v1/auth/mfa/totp/enroll/verify", (route) => {
    seen.verifyHeaders.push(route.request().headers());
    const body = route.request().postDataJSON() as Record<string, unknown>;
    seen.verifyBodies.push(body);
    const accepted = verify(body);
    return route.fulfill({
      status: accepted ? 200 : 400,
      contentType: "application/json",
      body: JSON.stringify(
        accepted
          ? {
              success: true,
              data: {
                activated: true,
                recoveryCodes: ["AAAA-1111", "BBBB-2222"]
              }
            }
          : { success: false, error: { code: "MFA_INVALID_CODE" } }
      )
    });
  });
  // The "continue" click navigates to /admin; keep it from hitting the server.
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
  return seen;
}

test.describe("login: pre-session enrolment step", () => {
  test("QR and key appear, a wrong code retries, a right code shows recovery codes once", async ({
    page
  }) => {
    const seen = await openEnrolStep(page, {
      verify: (body) => body.code === "123456"
    });

    await expect(page.locator("#enrol-form")).toBeVisible();
    await expect(page.locator("#login-form")).toBeHidden();
    await expect(page.locator("#enrol-code")).toBeFocused();
    await expect(page.locator("#enrol-qr svg")).toBeVisible();
    await expect(page.locator("#enrol-secret")).toHaveText(SECRET);

    // The grant went in the header, on both calls' shape, and nowhere else.
    expect(seen.startHeaders[0]!["x-awcms-mfa-enrollment-token"]).toBe(GRANT);
    expect(page.url()).not.toContain(GRANT);
    expect(
      await page.evaluate(
        () => JSON.stringify(localStorage) + JSON.stringify(sessionStorage)
      )
    ).not.toContain(GRANT);
    // The DOM holds the QR and the key, never the grant or the otpauth URI.
    const html = await page.content();
    expect(html).not.toContain(GRANT);
    expect(html).not.toContain("otpauth://");

    await page.locator("#enrol-code").fill("000000");
    await page.locator("#enrol-submit").click();
    await expect(page.locator("#enrol-error")).toBeVisible();
    await expect(page.locator("#enrol-form")).toBeVisible();

    await page.locator("#enrol-code").fill("123 456");
    await page.locator("#enrol-submit").click();

    await expect(page.locator("#enrol-recovery")).toBeVisible();
    await expect(page.locator("#enrol-form")).toBeHidden();
    await expect(page.locator("#enrol-recovery-list li")).toHaveText([
      "AAAA-1111",
      "BBBB-2222"
    ]);
    // The secret and its QR are gone once enrolment is done.
    await expect(page.locator("#enrol-secret")).toHaveText("");
    await expect(page.locator("#enrol-qr svg")).toHaveCount(0);

    expect(seen.verifyBodies).toEqual([{ code: "000000" }, { code: "123456" }]);
    expect(seen.verifyHeaders[1]!["x-awcms-mfa-enrollment-token"]).toBe(GRANT);

    await page.locator("#enrol-continue").click();
    await page.waitForURL("**/admin");
  });

  test("a refused start returns to the password step with a generic message", async ({
    page
  }) => {
    await openEnrolStep(page, { startOk: false });

    await expect(page.locator("#login-form")).toBeVisible();
    await expect(page.locator("#enrol-form")).toBeHidden();
    await expect(page.locator("#login-error")).toBeVisible();
  });

  test("the QR chunk is lazy, and failing to load it returns to the password step (#1425)", async ({
    page
  }) => {
    const scripts: string[] = [];
    page.on("request", (request) => {
      if (request.resourceType() === "script") scripts.push(request.url());
    });
    await page.route("**/_astro/enrolment-qr*.js", (route) => route.abort());
    await openEnrolStep(page);

    await expect(page.locator("#login-form")).toBeVisible();
    await expect(page.locator("#enrol-form")).toBeHidden();
    await expect(page.locator("#login-error")).toBeVisible();
    // The chunk was only asked for after MFA_ENROLLMENT_REQUIRED, never on load.
    expect(scripts.filter((url) => url.includes("enrolment-qr"))).toHaveLength(
      1
    );
    expect(await page.content()).not.toContain(GRANT);
  });

  test("back returns to the password step and clears the secret, and the attempt cap does too", async ({
    page
  }) => {
    await openEnrolStep(page, { verify: () => false });
    await expect(page.locator("#enrol-form")).toBeVisible();

    await page.locator("#enrol-back").click();
    await expect(page.locator("#login-form")).toBeVisible();
    await expect(page.locator("#enrol-qr svg")).toHaveCount(0);
    await expect(page.locator("#enrol-secret")).toHaveText("");

    await page.locator("#password").fill("a-correct-password-1234");
    await page.locator("#login-submit").click();
    await expect(page.locator("#enrol-form")).toBeVisible();

    const max = Number(
      await page.locator("#login-form").getAttribute("data-mfa-max-attempts")
    );
    for (let i = 0; i < max; i++) {
      await page.locator("#enrol-code").fill("000000");
      await page.locator("#enrol-submit").click();
      if (i < max - 1) await expect(page.locator("#enrol-error")).toBeVisible();
    }
    await expect(page.locator("#login-form")).toBeVisible();
    await expect(page.locator("#login-error")).toBeVisible();
    await expect(page.locator("#enrol-form")).toBeHidden();
  });

  test("no sideways scroll at 360px, in the enrolment step or the recovery codes", async ({
    page
  }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await openEnrolStep(page);
    await expect(page.locator("#enrol-form")).toBeVisible();
    const overflow = () =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth
      );
    expect(await overflow()).toBe(false);

    await page.locator("#enrol-code").fill("123456");
    await page.locator("#enrol-submit").click();
    await expect(page.locator("#enrol-recovery")).toBeVisible();
    expect(await overflow()).toBe(false);
  });
});
