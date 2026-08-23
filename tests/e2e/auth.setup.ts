/**
 * Log the owner in ONCE for the whole suite (Playwright "setup project").
 *
 * ## Why: argon2id is expensive on purpose, and 11 specs were paying it
 *
 * Every authenticated spec used to drive the real `/login` form itself. With
 * `fullyParallel: true` that meant up to five simultaneous argon2id
 * verifications — `Bun.password.verify` on Bun's defaults, which is memory- and
 * CPU-hard by design — on top of a server already rendering admin pages.
 *
 * The result was a suite that usually finished in ~15s and occasionally took
 * four minutes with six or seven failures, every one of them a 30s
 * `waitForURL` timeout **at the login step**, in specs with nothing to do with
 * each other. It reproduced with the screen-sweep specs removed, so it predates
 * them; `--workers=1` made it disappear. CI hid it behind `retries: 1`, which
 * is why it surfaced as one "flaky" line rather than as a problem.
 *
 * Nothing about argon2's cost is wrong — that cost is the control. What was
 * wrong is paying it eleven times to test things that are not authentication.
 *
 * ## What this does NOT change
 *
 * `login.e2e.ts` still drives the real form, because the login flow is its
 * subject. So do the two specs that authenticate as somebody other than the
 * owner. Four logins instead of thirteen, and only one of them contends with
 * anything.
 */
import { test as setup, expect } from "@playwright/test";
import path from "node:path";

import { provideTenant } from "./support/e2e-auth";

const tenantId = process.env.E2E_TENANT_ID;
const loginIdentifier = process.env.E2E_LOGIN_IDENTIFIER;
const password = process.env.E2E_PASSWORD;

export const OWNER_STORAGE_STATE = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "../../playwright/.auth/owner.json"
);

setup("authenticate as the seeded owner", async ({ page }) => {
  setup.skip(
    !(tenantId && loginIdentifier && password),
    "requires a seeded tenant — CI e2e-smoke provisions one via POST /api/v1/setup/initialize"
  );

  await page.goto("/login");
  await provideTenant(page, tenantId!);
  await page.locator("#login-identifier").fill(loginIdentifier!);
  await page.locator("#password").fill(password!);
  await page.locator("#login-submit").click();
  await page.waitForURL("**/admin");

  // Prove the session is real before saving it. A storage state captured from a
  // page that never reached `/admin` would hand every dependent spec a
  // logged-out session, and they would fail somewhere far from the cause.
  await expect(page.locator(".admin-shell")).toBeAttached();

  await page.context().storageState({ path: OWNER_STORAGE_STATE });
});
