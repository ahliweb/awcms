/**
 * Authenticated admin office-lifecycle E2E (Issue #171) — exercises the
 * permission-gated per-row write actions on `/admin/offices`: log in through
 * the real `/login` form → session cookies → create a throwaway office →
 * inline-edit its name (`PATCH /api/v1/offices/{id}`) → soft-delete it
 * (`DELETE /api/v1/offices/{id}`) → restore it from the deleted-offices section
 * (`POST /api/v1/offices/{id}/restore`), asserting the SSR table reflects each
 * step after reload.
 *
 * Env-gated exactly like `admin-offices-create.e2e.ts`: the CI `e2e-smoke` job
 * seeds a tenant + owner via `POST /api/v1/setup/initialize` and hands the
 * credentials through env vars. Skipped (not failed) when they are absent, so a
 * local `bun run test:e2e` without a seeded DB stays green. The seeded owner
 * role holds every permission, so the `office_management.update`/`.delete`
 * gates pass and the controls render.
 */
import { test, expect } from "@playwright/test";

const tenantId = process.env.E2E_TENANT_ID;
const loginIdentifier = process.env.E2E_LOGIN_IDENTIFIER;
const password = process.env.E2E_PASSWORD;

const seeded = Boolean(tenantId && loginIdentifier && password);

test.describe("admin offices edit/delete/restore (authenticated)", () => {
  test.skip(
    !seeded,
    "requires a seeded tenant — CI e2e-smoke provisions one via POST /api/v1/setup/initialize"
  );

  test("owner edits, soft-deletes, then restores an office", async ({
    page
  }) => {
    await page.goto("/login");
    await page.locator("#tenant-id").fill(tenantId!);
    await page.locator("#login-identifier").fill(loginIdentifier!);
    await page.locator("#password").fill(password!);
    await page.locator("#login-submit").click();
    await page.waitForURL("**/admin");

    await page.goto("/admin/offices");

    // Create a throwaway office to act on (unique code per run).
    const code = `ED-E2E-${Date.now()}`;
    await expect(page.locator("#office-create-form")).toBeVisible();
    await page.locator("#office-code").fill(code);
    await page.locator("#office-name").fill("Edit E2E Original");
    await page.locator("#office-type").selectOption("branch");
    await page.locator("#office-create-submit").click();

    const table = page.locator("#offices-table");
    await expect(table).toContainText(code);

    // The row is keyed by its office id; find it via the code cell.
    const row = page.locator("tr", { hasText: code });
    await expect(row).toBeVisible();

    // Inline edit: change the name and Save → reload → new name shown.
    await row.locator(".office-name-input").fill("Edit E2E Renamed");
    await row.locator(".office-save-btn").click();
    await expect(page.locator("#offices-table")).toBeVisible();
    const renamedRow = page.locator("tr", { hasText: code });
    await expect(renamedRow.locator(".office-name-input")).toHaveValue(
      "Edit E2E Renamed"
    );

    // Soft-delete: accept the confirm dialog → row leaves the active table and
    // appears in the deleted-offices section.
    page.once("dialog", (dialog) => dialog.accept());
    await renamedRow.locator(".office-delete-btn").click();

    const deletedTable = page.locator("#deleted-offices-table");
    await expect(deletedTable).toBeVisible();
    await expect(deletedTable).toContainText(code);
    await expect(page.locator("#offices-table")).not.toContainText(code);

    // Restore: bring it back → returns to the active table.
    const deletedRow = page.locator("#deleted-offices-table tr", {
      hasText: code
    });
    await deletedRow.locator(".office-restore-btn").click();

    await expect(page.locator("#offices-table")).toContainText(code);
  });
});
