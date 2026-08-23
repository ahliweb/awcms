/**
 * Authenticated admin write-action E2E (Issue #171) — exercises the
 * permission-gated write controls on `/admin/users`: log in through the real
 * `/login` form → session cookies → `/admin` guard → the Users screen renders
 * the activate/deactivate + role-assignment controls (the seeded owner holds
 * `identity_access.access_control.configure` and `.assign`) → a role-assign
 * round-trips through `POST /api/v1/access/assignments` via cookie auth.
 *
 * Env-gated exactly like `admin-offices-create.e2e.ts`: the CI `e2e-smoke` job
 * seeds a tenant + owner via `POST /api/v1/setup/initialize` and hands the
 * credentials through env vars. Skipped (not failed) when they are absent.
 *
 * The single seeded user is the owner, who already holds the only role, so the
 * assertion is deliberately non-destructive: re-assigning the already-held role
 * is rejected (409) and the client surfaces the generic error — proving the
 * external CSP-safe script, `sendJson`, and the guarded endpoint all round-trip
 * without deactivating the owner (which would revoke the running session).
 */
import { test, expect } from "@playwright/test";

const tenantId = process.env.E2E_TENANT_ID;
const loginIdentifier = process.env.E2E_LOGIN_IDENTIFIER;
const password = process.env.E2E_PASSWORD;

const seeded = Boolean(tenantId && loginIdentifier && password);

test.describe("admin users write controls (authenticated)", () => {
  test.skip(
    !seeded,
    "requires a seeded tenant — CI e2e-smoke provisions one via POST /api/v1/setup/initialize"
  );

  test("owner sees the write controls and a duplicate assign is rejected", async ({
    page
  }) => {
    // Already authenticated as the owner: the `setup` project logged in once
    // and this project reuses that session. See `tests/e2e/auth.setup.ts`.
    await page.goto("/admin/users");

    // The owner holds read + configure + assign, so the table and its Actions
    // column render.
    const table = page.locator("#users-table");
    await expect(table).toBeVisible();

    // Deactivate control renders for the active owner (configure gate).
    await expect(page.locator(".js-user-status").first()).toBeVisible();

    // Assign the already-held role → 409 → the client shows the generic error.
    const assignButton = page.locator(".js-assign-role").first();
    await expect(assignButton).toBeVisible();

    // WAIT FOR THE PAGE TO BE ABLE TO HEAR THE CLICK.
    //
    // This test was intermittently red, and the timeout it hit could have come
    // from either of two causes that look identical: a slow round trip, or a
    // click discarded because the delegated listener was not attached yet.
    // `onAction` binds on `document` inside a `<script type="module">`, which is
    // deferred — so between paint and execution the button is in the DOM, looks
    // enabled, and does nothing at all when clicked.
    //
    // Waiting on the readiness marker removes the second cause outright rather
    // than widening a timeout until the first one stops showing. See
    // `ADMIN_DELEGATION_READY_ATTRIBUTE` in `src/lib/ui/admin-form-client.ts`.
    await expect(
      page.locator("html[data-admin-delegation-ready]")
    ).toBeAttached({ timeout: 15_000 });

    // Then synchronise on the response itself rather than on how long the UI
    // takes to notice it, which is what removes the first cause.
    const rejected = page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/access/assignments") &&
        response.request().method() === "POST",
      { timeout: 20_000 }
    );
    await assignButton.click();
    const response = await rejected;
    expect(response.status()).toBe(409);

    await expect(page.locator("#users-action-error")).toBeVisible();
  });
});
