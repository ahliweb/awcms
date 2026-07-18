/**
 * Authenticated create-email-template E2E (Issue #171 write actions) — the full
 * loop: log in through the real `/login` form → session cookies → `/admin`
 * guard → the create form on the email-templates screen POSTs to
 * `POST /api/v1/email/templates` via cookie auth → page reload → the new row
 * appears in the SSR-rendered `#email-templates-table`.
 *
 * Env-gated exactly like `admin-offices-create.e2e.ts`: the CI `e2e-smoke` job
 * seeds a tenant + owner via `POST /api/v1/setup/initialize` and hands the
 * credentials through env vars. Skipped (not failed) when absent, so a local
 * `bun run test:e2e` without a seeded DB stays green. The seeded owner holds
 * every permission, so the `email.template.create` gate passes.
 *
 * Retry-safe: unlike offices (whose `office_code` can be made per-run unique),
 * `templateKey` must be one of a FIXED base-category allowlist and is unique
 * per ACTIVE template — a CI retry (retries: 1) of a create that already
 * committed would 409. So the spec is idempotent: if the chosen category is
 * already present in the table (a prior attempt created it), that is the
 * success state and we assert it; otherwise we create it fresh and assert the
 * per-run unique NAME appears (which only holds when THIS run's create went
 * through — guarding against a false green).
 */
import { test, expect } from "@playwright/test";

const tenantId = process.env.E2E_TENANT_ID;
const loginIdentifier = process.env.E2E_LOGIN_IDENTIFIER;
const password = process.env.E2E_PASSWORD;

const seeded = Boolean(tenantId && loginIdentifier && password);

// A base category unlikely to be pre-seeded, so a fresh e2e-smoke DB exercises
// the real create path on the first attempt.
const templateKey = "system.maintenance";

test.describe("admin email templates create (authenticated)", () => {
  test.skip(
    !seeded,
    "requires a seeded tenant — CI e2e-smoke provisions one via POST /api/v1/setup/initialize"
  );

  test("owner creates an email template and sees the new row", async ({
    page
  }) => {
    await page.goto("/login");
    await page.locator("#tenant-id").fill(tenantId!);
    await page.locator("#login-identifier").fill(loginIdentifier!);
    await page.locator("#password").fill(password!);
    await page.locator("#login-submit").click();

    // The client script redirects to /admin on success.
    await page.waitForURL("**/admin");

    await page.goto("/admin/email-templates");

    // The owner holds `email.template.create`, so the form renders.
    await expect(page.locator("#email-template-create-form")).toBeVisible();

    const table = page.locator("#email-templates-table");
    await expect(table).toBeVisible();

    // Idempotent: if a prior (retried) attempt already created this category,
    // the success state is already reached — assert and finish.
    if (await table.getByText(templateKey, { exact: true }).count()) {
      await expect(table).toContainText(templateKey);
      return;
    }

    const name = `E2E Template ${Date.now()}`;
    await page.locator("#email-template-key").selectOption(templateKey);
    await page.locator("#email-template-name").fill(name);
    await page.locator("#email-template-subject").fill("E2E maintenance");
    await page
      .locator("#email-template-body")
      .fill("Scheduled maintenance window notice for E2E.");
    await page.locator("#email-template-create-submit").click();

    // On success the client reloads; the reloaded SSR table lists the row and
    // the error box stays hidden (proves the create actually succeeded).
    await expect(table).toBeVisible();
    await expect(table).toContainText(name);
    await expect(page.locator("#email-template-create-error")).toBeHidden();
  });
});
