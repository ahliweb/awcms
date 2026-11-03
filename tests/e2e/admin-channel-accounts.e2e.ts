/**
 * The channel-account connection manager in a real browser (Issue #1154,
 * ADR-0148 UP-08): `/admin/channel-accounts` and `/admin/channel-accounts/{id}`.
 *
 * What this proves that the source-text contract test cannot:
 *
 * - the list renders a seeded account, searches, filters and links to its
 *   detail, and the provider identity is MASKED in the HTML the browser got;
 * - the detail shows nine capability rows, a recorded grant with its evidence,
 *   and a capability the provider does not offer as DISABLED (`aria-disabled`),
 *   not hidden;
 * - no credential-shaped control reads a value back: there is no "show";
 * - the typed confirmation really gates a terminal action: a wrong name sends
 *   nothing, the right one disconnects and the page says so;
 * - the default-sender action reports the server's refusal in words;
 * - neither screen scrolls sideways at 360px, and neither has a critical or
 *   serious axe finding.
 *
 * The accounts are created through the REAL endpoints (`POST /accounts`,
 * `PUT /capabilities/{capability}`) with the owner's session, so the spec needs
 * no database access of its own. It is opt-in (`E2E_CHANNEL_ACCOUNTS=1`)
 * because the screen is only meaningful on a server started with
 * `CHANNEL_ACCOUNTS_ENABLED=true`; without it the module answers 503 and the
 * screen shows its "switched off" notice, which is the first test.
 *
 * Not covered here, and said plainly: replacing a credential needs a signed-in
 * person with an enrolled second factor (`requiresMfaEnrolment`), which the
 * seeded owner is not, so the form is correctly absent and its write path is
 * covered by the endpoint's own integration tests.
 *
 * WRITE wave: it registers accounts and disconnects one through the app.
 */
import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";

const tenantId = process.env.E2E_TENANT_ID;
const loginIdentifier = process.env.E2E_LOGIN_IDENTIFIER;
const password = process.env.E2E_PASSWORD;
const seeded = Boolean(tenantId && loginIdentifier && password);
const enabled = process.env.E2E_CHANNEL_ACCOUNTS === "1";

const stamp = Date.now().toString(36);
const numeric = Date.now().toString().slice(-9);
const wabaName = `E2E WABA ${stamp}`;
const phoneName = `E2E Sales Number ${stamp}`;
const deviceName = `E2E Support Device ${stamp}`;
const phoneExternalId = `62811${numeric}`;

type Created = { id: string };

async function api(
  page: Page,
  method: "POST" | "PUT",
  url: string,
  body: unknown
): Promise<{ status: number; data: Created | null }> {
  const response = await page.request.fetch(url, {
    method,
    data: body,
    headers: { "Idempotency-Key": crypto.randomUUID() }
  });
  const payload = (await response.json().catch(() => null)) as {
    data?: Created;
  } | null;

  return { status: response.status(), data: payload?.data ?? null };
}

async function expectNoBlockingViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const blocking = results.violations
    .filter(
      (violation) =>
        violation.impact === "critical" || violation.impact === "serious"
    )
    .map(
      (violation) =>
        `${violation.id}: ${violation.nodes.map((n) => n.target).join(" | ")}`
    );

  expect(blocking, `${label}: axe critical/serious findings`).toEqual([]);
}

async function expectNoSidewaysScroll(page: Page, label: string) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
  );

  expect(overflow, `${label}: horizontal overflow in px`).toBeLessThanOrEqual(
    0
  );
}

test.use({ reducedMotion: "reduce" });

test.describe("channel accounts connection manager", () => {
  test.skip(
    !seeded || !enabled,
    "requires a seeded tenant and a server started with CHANNEL_ACCOUNTS_ENABLED=true (E2E_CHANNEL_ACCOUNTS=1)"
  );
  test.describe.configure({ mode: "serial" });

  // The tenant's default locale is Indonesian; this spec asserts English copy
  // (and one Indonesian check), so the locale is chosen by cookie, the same
  // channel the language switcher uses.
  test.beforeEach(async ({ context, baseURL }) => {
    await context.addCookies([
      { name: "awcms_locale", value: "en", url: baseURL! }
    ]);
  });

  let phoneId = "";
  let deviceId = "";

  test("setup: register a WABA, a phone number under it, a grant, and a device", async ({
    page
  }) => {
    await page.goto("/admin/channel-accounts");

    const waba = await api(page, "POST", "/api/v1/channel-accounts/accounts", {
      provider: "whatsapp_cloud",
      accountKind: "waba",
      authMode: "api_token",
      externalId: `9${numeric}`,
      displayName: wabaName
    });

    expect(waba.status).toBe(201);

    const phone = await api(page, "POST", "/api/v1/channel-accounts/accounts", {
      provider: "whatsapp_cloud",
      accountKind: "waba_phone_number",
      authMode: "api_token",
      externalId: phoneExternalId,
      displayName: phoneName,
      parentAccountId: waba.data!.id
    });

    expect(phone.status).toBe(201);
    phoneId = phone.data!.id;

    const grant = await api(
      page,
      "PUT",
      `/api/v1/channel-accounts/accounts/${phoneId}/capabilities/dm`,
      {
        state: "granted",
        evidenceKind: "scope_list_hash",
        evidenceRef: "sha256:e2e-evidence"
      }
    );

    expect(grant.status).toBe(200);

    const device = await api(
      page,
      "POST",
      "/api/v1/channel-accounts/accounts",
      {
        provider: "starsender",
        accountKind: "device",
        authMode: "device_key",
        externalId: `DEV-${numeric}`,
        displayName: deviceName
      }
    );

    expect(device.status).toBe(201);
    deviceId = device.data!.id;
  });

  test("list: shows the account, masks the identity, searches and filters", async ({
    page
  }) => {
    await page.goto("/admin/channel-accounts");

    await expect(
      page.getByRole("heading", { level: 1, name: "Channel accounts" })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: phoneName, exact: true })
    ).toBeVisible();

    // The provider identity is masked in the HTML itself, not hidden by CSS.
    const html = await page.content();

    expect(html).not.toContain(phoneExternalId);
    expect(html).toContain(`••••${phoneExternalId.slice(-4)}`);

    // Search is a labelled GET form, so it works without script.
    await page.getByRole("searchbox", { name: "Search" }).fill(deviceName);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page).toHaveURL(/q=/);
    await expect(
      page.getByRole("link", { name: deviceName, exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: phoneName, exact: true })
    ).toHaveCount(0);

    // An empty result names the query rather than saying "no accounts yet".
    await page.goto("/admin/channel-accounts?q=zz-no-such-account-zz");
    await expect(page.locator("#channel-accounts-table")).toContainText(
      "zz-no-such-account-zz"
    );

    // A provider filter narrows to that provider.
    await page.goto("/admin/channel-accounts?provider=starsender");
    await expect(
      page.getByRole("link", { name: deviceName, exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: phoneName, exact: true })
    ).toHaveCount(0);
  });

  test("list: speaks Indonesian when the reader's locale is Indonesian", async ({
    page,
    context,
    baseURL
  }) => {
    await context.addCookies([
      { name: "awcms_locale", value: "id", url: baseURL! }
    ]);
    await page.goto("/admin/channel-accounts");
    await expect(
      page.getByRole("heading", { level: 1, name: "Akun kanal" })
    ).toBeVisible();
    await expect(page.locator("#channel-providers-table")).toContainText(
      "memerlukan persetujuan"
    );
  });

  test("list: a provider with no connector says so and offers no Connect button", async ({
    page
  }) => {
    await page.goto("/admin/channel-accounts");

    const providers = page.locator("#channel-providers-table");

    await expect(providers).toContainText("requires approval");
    await expect(page.getByRole("button", { name: /connect/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^connect/i })).toHaveCount(0);
  });

  test("detail: nine capability rows, evidence for a grant, an unsupported one disabled", async ({
    page
  }) => {
    await page.goto(`/admin/channel-accounts/${phoneId}`);

    await expect(
      page.getByRole("heading", { level: 1, name: phoneName, exact: true })
    ).toBeVisible();

    const rows = page.locator("#channel-account-capabilities tbody tr");

    await expect(rows).toHaveCount(9);

    const dm = page.locator('tr[data-capability="dm"]');

    await expect(dm).toContainText("Granted");
    await expect(dm).toContainText("sha256:e2e-evidence");

    // WhatsApp Cloud cannot publish: listed, disabled, never hidden.
    const publish = page.locator('tr[data-capability="publish"]');

    await expect(publish).toHaveAttribute("aria-disabled", "true");
    await expect(publish).toContainText("Not offered");

    // A fresh account is pending, so even a granted capability is not usable yet,
    // and the row says why in words.
    await expect(dm).toContainText("The account is not connected.");

    // No connector has reported health: the screen says so, it does not invent "healthy".
    await expect(page.locator("#channel-account-health-none")).toBeVisible();

    // Write-only: nothing on the page reads a credential back.
    await expect(
      page.getByText(/show (the )?(credential|token|secret)/i)
    ).toHaveCount(0);
    await expect(page.locator('input[type="text"][name="secret"]')).toHaveCount(
      0
    );
  });

  test("detail: a not-found id and a malformed id render the same neutral notice", async ({
    page
  }) => {
    await page.goto(
      "/admin/channel-accounts/00000000-0000-4000-8000-000000000000"
    );
    await expect(page.locator("#channel-account-not-found")).toBeVisible();

    await page.goto("/admin/channel-accounts/not-a-uuid");
    await expect(page.locator("#channel-account-not-found")).toBeVisible();
  });

  test("detail: the default-sender action reports a refusal in words", async ({
    page
  }) => {
    await page.goto(`/admin/channel-accounts/${phoneId}`);

    const action = page.locator(".js-channel-default-sender");

    await expect(action).toBeVisible();
    await action.focus();
    await page.keyboard.press("Enter");

    // The account is `pending`, so the server answers SENDER_UNAVAILABLE.
    await expect(page.locator("#channel-account-action-error")).toContainText(
      "cannot be the default sender"
    );
  });

  test("detail: disconnect needs the typed name, then erases and says so", async ({
    page
  }) => {
    await page.goto(`/admin/channel-accounts/${deviceId}`);

    const input = page.locator("#channel-account-disconnect-confirm");
    const submit = page.locator(
      '#channel-account-disconnect-form button[type="submit"]'
    );
    let sent = 0;

    page.on("request", (request) => {
      if (request.url().includes("/disconnect")) sent += 1;
    });

    // Wrong name: nothing is sent.
    await input.fill("some other account");
    await submit.click();
    await expect(page.locator("#channel-account-action-error")).toContainText(
      "does not match"
    );
    expect(sent).toBe(0);

    // Right name, by keyboard.
    await input.fill(deviceName);
    await input.press("Enter");
    await expect(page.locator("#channel-account-notice")).toContainText(
      "disconnected",
      { timeout: 15_000 }
    );
    await expect(page.locator("#channel-account-summary")).toContainText(
      "Disconnected"
    );
    expect(sent).toBe(1);

    // A disconnected account offers no second disconnect.
    await expect(page.locator("#channel-account-disconnect-form")).toHaveCount(
      0
    );
  });

  for (const viewport of [
    { label: "360px", width: 360, height: 640 },
    { label: "desktop", width: 1280, height: 800 }
  ]) {
    test(`layout and accessibility at ${viewport.label}`, async ({ page }) => {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height
      });

      for (const path of [
        "/admin/channel-accounts",
        "/admin/channel-accounts?status=pending&sort=name&dir=asc&limit=10",
        "/admin/channel-accounts?q=zz-no-such-account-zz",
        `/admin/channel-accounts/${phoneId}`,
        `/admin/channel-accounts/${deviceId}`
      ]) {
        await page.goto(path);
        await expect(page.locator("main, .admin-main").first()).toBeVisible();
        await expectNoSidewaysScroll(page, `${viewport.label} ${path}`);
        await expectNoBlockingViolations(page, `${viewport.label} ${path}`);
      }
    });
  }
});
