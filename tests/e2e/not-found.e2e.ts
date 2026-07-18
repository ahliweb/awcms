/**
 * First real E2E spec for awcms (Playwright + Bun) — see skill
 * `.claude/skills/awcms-browser-test/SKILL.md`.
 *
 * awcms is API-only today: no seeded data and (until the admin UI lands) no
 * rendered pages EXCEPT the catch-all 404 (`src/pages/[...path].ts`, reusing
 * `src/lib/html/error-responses.ts`). That makes an unknown path the one
 * browser target that needs zero fixtures — exactly the "pick a target that
 * needs no seeded data" convention (skill #4) — while still exercising a real
 * property worth a browser: a public server must answer a bad path with a
 * clean page that leaks NOTHING internal (skill #5, Issue #540).
 *
 * Run: `bun run dev` (or `bun run build && bun run start`) in one terminal with
 * `DATABASE_URL` set, then `bun run test:e2e` in another.
 */
import { test, expect } from "@playwright/test";

test.describe("catch-all 404 page", () => {
  test("an unknown browser path renders a clean 404 HTML page", async ({
    page
  }) => {
    const response = await page.goto("/this-path-does-not-exist-42");

    expect(response?.status()).toBe(404);
    await expect(page.locator("h1")).toHaveText("Not Found");
    await expect(page.locator("body")).toContainText(
      "The page you requested does not exist."
    );
  });

  test("the 404 page leaks no internal detail (no stack trace, no infra names)", async ({
    page
  }) => {
    await page.goto("/boom-" + "x".repeat(8));

    // Assert on the FULL served HTML, not just visible text: a leak could hide
    // in a comment or attribute. The generic error page must never carry any
    // of these markers regardless of how the miss was produced.
    const html = (await page.content()).toLowerCase();
    for (const marker of [
      "stack",
      "at object",
      "postgres",
      "econnrefused",
      "node_modules",
      "/home/",
      "bun.sql"
    ]) {
      expect(html).not.toContain(marker);
    }
  });
});
