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
    //
    // The role is SELECTED explicitly rather than left on whatever the dropdown
    // defaults to, and that is the whole point of this block. The select lists
    // every role in the tenant, so `admin-roles.e2e.ts` creating one — which it
    // does, concurrently — changed the default to a role the owner does NOT
    // hold. The assign then SUCCEEDED with 200 and this test failed asserting
    // 409. That was the CI flake: shared tenant state, not a race in the page.
    const assignSelect = page.locator(".js-assign-role-select").first();
    await expect(assignSelect).toBeVisible();
    await assignSelect.selectOption({ label: "owner" });

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

  /**
   * Issue #1196 / ADR-0149 — the data-page pattern on its first adopter. Pure
   * GET navigation: no mutation, and it must work WITHOUT the page's script, so
   * nothing here waits for `data-admin-delegation-ready`.
   */
  test("the list is a data page: search, chips, sort, empty state, pager", async ({
    page
  }) => {
    await page.goto("/admin/users");

    // The search landmark is named, and the box inside it is labelled.
    const search = page.getByRole("search", {
      name: /search users|cari pengguna/i
    });
    await expect(search).toBeVisible();
    await expect(search.getByRole("searchbox")).toBeVisible();

    // The default sort is the login identifier, ascending, on that header only.
    const sorted = page.locator("th[aria-sort]");
    await expect(sorted).toHaveCount(1);
    await expect(sorted).toHaveAttribute("aria-sort", "ascending");

    // The pager is a named nav; with a single seeded user both directions are
    // unavailable, announced as such and not focusable.
    const pager = page.getByRole("navigation", {
      name: /pagination|paginasi/i
    });
    await expect(pager).toBeVisible();
    for (const step of await pager.locator('[aria-disabled="true"]').all()) {
      await expect(step).not.toHaveAttribute("href", /.*/);
    }
    await expect(pager.locator('a[aria-current="true"]')).toHaveText("25");

    // Activating the sorted header flips the direction in the URL and aria-sort.
    await page.locator("th[aria-sort] a").click();
    await expect(page).toHaveURL(/[?&]sort=identifier&dir=desc/);
    await expect(page.locator("th[aria-sort]")).toHaveAttribute(
      "aria-sort",
      "descending"
    );

    // A filter becomes a removable chip; removing it is a plain link.
    await page.goto("/admin/users?status=active");
    const chip = page.locator('[data-chip="status"]');
    await expect(chip).toHaveCount(1);
    await chip.getByRole("link").click();
    await expect(page).toHaveURL(/\/admin\/users$/);
    await expect(page.locator("[data-chip]")).toHaveCount(0);

    // A query nothing matches names itself and offers the way back.
    await page.goto("/admin/users?q=zz-no-such-user-zz");
    const empty = page.locator('[data-empty="filtered"]');
    await expect(empty).toContainText("zz-no-such-user-zz");
    await empty
      .getByRole("link", { name: /clear filters|hapus filter/i })
      .click();
    await expect(page).toHaveURL(/\/admin\/users$/);
    await expect(page.locator("#users-table")).toBeVisible();
  });
});
