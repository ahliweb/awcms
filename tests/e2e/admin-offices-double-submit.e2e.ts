/**
 * Double submit on an admin create form (Issue #1224) — see skill
 * `awcms-browser-test` and `docs/awcms/ui-single-flight-audit.md`.
 *
 * `/admin/offices`' create form is bound through `onSubmit`, which owns the
 * in-flight flag. This spec proves it in a real browser, where a unit test with
 * a fake `document` cannot: a double click and an Enter press, with the POST
 * held in flight long enough that the second event genuinely arrives while the
 * first is pending, must produce exactly ONE `POST /api/v1/offices` and exactly
 * one new row.
 *
 * Classified WRITE wave: it creates an office through the app. It needs the
 * seeded tenant + owner of the CI `e2e-smoke` job and is skipped (not failed)
 * without one, like the other authenticated specs.
 */
import { test, expect } from "@playwright/test";

const seeded = Boolean(
  process.env.E2E_TENANT_ID &&
  process.env.E2E_LOGIN_IDENTIFIER &&
  process.env.E2E_PASSWORD
);

test.describe("admin offices create: double submit", () => {
  test.skip(
    !seeded,
    "requires a seeded tenant — CI e2e-smoke provisions one via POST /api/v1/setup/initialize"
  );

  test("a double click and an Enter while the request is pending create ONE office", async ({
    page
  }) => {
    const posts: string[] = [];

    // Hold the response so the second click/Enter lands while the first
    // request is still pending. Without the hold, a fast local server answers
    // before the second event and the spec would pass for the wrong reason.
    await page.route("**/api/v1/offices", async (route) => {
      if (route.request().method() === "POST") {
        posts.push(route.request().url());
        await new Promise((done) => setTimeout(done, 750));
      }
      await route.continue();
    });

    await page.goto("/admin/offices");

    const form = page.locator("#office-create-form");
    await expect(form).toBeVisible();

    const code = `BR-DBL-${Date.now()}`;
    await page.locator("#office-code").fill(code);
    await page.locator("#office-name").fill("E2E Double Submit");
    await page.locator("#office-type").selectOption("branch");

    const submit = page.locator("#office-create-submit");

    // Two clicks, then Enter in a text field: the three ways a person submits
    // twice. `dblclick` dispatches both clicks synchronously.
    await submit.dblclick();
    await page.locator("#office-name").press("Enter");

    // While pending: visibly busy and the submit control is disabled.
    await expect(form).toHaveAttribute("aria-busy", "true");
    await expect(submit).toBeDisabled();

    // The page reloads on success; the SSR table then lists the new office.
    const table = page.locator("#offices-table");
    await expect(table).toContainText(code);

    expect(posts).toHaveLength(1);
    // One row, not two: the duplicate would have been a 409 on the
    // `(tenant_id, office_code)` unique index, i.e. a false "already exists".
    await expect(table.getByText(code)).toHaveCount(1);
    await expect(page.locator("#office-create-error")).toBeHidden();
  });
});
