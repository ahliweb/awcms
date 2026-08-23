/**
 * Every permission-gated admin screen actually DENIES a user who holds nothing.
 *
 * ## The gap this closes
 *
 * The per-screen contract tests are source greps — they prove a page mentions
 * a permission key, not that a control is hidden from someone lacking it. The
 * render smoke test (`admin-screens-render.e2e.ts`) loads every screen as the
 * seeded OWNER, who holds every permission. So nothing anywhere had ever
 * watched an admin screen answer a user with no permissions at all.
 *
 * That is the half of authorization worth checking at runtime. A screen can
 * name the right key, gate the right control, pass every static test, and still
 * render its contents — because the gate was written on a variable that is
 * `true` for the wrong reason, or because the deny branch was never exercised.
 *
 * ## What it asserts
 *
 * For all 47 gated screens, as a user whose role holds zero permissions:
 *
 * 1. **The denial renders.** `loadAdminScreen` never redirects (see
 *    `src/lib/auth/admin-screen.ts`), so a denied screen renders an element
 *    carrying `id="…-denied"`. `tests/admin-deny-path-contract.test.ts` keeps
 *    that hook present in the source; this requires it to actually appear.
 * 2. **The status is 200.** A denial is a rendered page, not an error. A 404
 *    here would mean the screen THREW — the `/admin/seo` class — and a throw
 *    must never be mistaken for a refusal.
 *
 * Soft assertions throughout: a run should report every screen that leaks, not
 * stop at the first.
 *
 * ## What it deliberately does NOT assert
 *
 * That a PARTIALLY-permissioned user sees the right subset. Expected results
 * differ per screen there, so it is per-screen knowledge rather than one
 * mechanical rule, and it is a larger piece of work. This covers the case where
 * one rule holds for every screen.
 */
import { test, expect } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { provideTenant } from "./support/e2e-auth";
import { seedRestrictedUser } from "./support/e2e-restricted-user";

const tenantId = process.env.E2E_TENANT_ID;
const databaseUrl = process.env.DATABASE_URL;

const seeded = Boolean(tenantId && databaseUrl);

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ADMIN_PAGES_ROOT = path.resolve(HERE, "../../src/pages/admin");

type GatedScreen = { url: string; source: string; deniedId: string };

/**
 * Every permission-gated admin route, with the denial hook its own source
 * declares.
 *
 * The hook is read FROM THE PAGE rather than derived from the URL: several
 * screens use a name that is not their route (`/admin/blog-ads` →
 * `#ads-denied`, `/admin` → `#dashboard-denied`). Deriving would produce
 * confident failures against ids that never existed.
 *
 * `/admin/account` is excluded because it loads through
 * `loadSelfServiceScreen` — there is no permission to deny; every
 * authenticated user owns their own account page. Identified by the loader it
 * calls, so the exemption cannot outlive its reason.
 */
function discoverGatedScreens(root: string, prefix = "/admin"): GatedScreen[] {
  const screens: GatedScreen[] = [];

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);

    if (entry.isDirectory()) {
      screens.push(...discoverGatedScreens(full, `${prefix}/${entry.name}`));
      continue;
    }

    if (!entry.name.endsWith(".astro")) continue;

    const source = readFileSync(full, "utf8");
    if (source.includes("loadSelfServiceScreen")) continue;

    const match = /id="([a-z0-9-]+-denied)"/.exec(source);
    if (!match?.[1]) continue;

    const base = entry.name.slice(0, -".astro".length);
    screens.push({
      url: base === "index" ? prefix : `${prefix}/${base}`,
      source: path.relative(process.cwd(), full),
      deniedId: match[1]
    });
  }

  return screens.sort((a, b) => a.url.localeCompare(b.url));
}

// Dynamic routes are excluded: a restricted user cannot reach the listing that
// would supply a real id, so there is nothing honest to request. They are
// covered as the OWNER by `admin-screens-render.e2e.ts`.
const gatedScreens = discoverGatedScreens(ADMIN_PAGES_ROOT).filter(
  (screen) => !screen.url.includes("[")
);

test.describe("admin screens deny a user holding no permissions", () => {
  test.skip(
    !seeded,
    "requires a seeded tenant and DATABASE_URL — CI e2e-smoke provides both"
  );

  test("the screen walk found them", () => {
    expect(
      gatedScreens.length,
      "no gated admin screens with a denial hook were discovered"
    ).toBeGreaterThan(40);
  });

  test("every gated screen renders its denial, not its contents", async ({
    page
  }) => {
    test.setTimeout(240_000);

    const user = await seedRestrictedUser(databaseUrl!, tenantId!);

    await page.goto("/login");
    await provideTenant(page, tenantId!);
    await page.locator("#login-identifier").fill(user.loginIdentifier);
    await page.locator("#password").fill(user.password);
    await page.locator("#login-submit").click();
    await page.waitForURL("**/admin");

    for (const screen of gatedScreens) {
      const response = await page.goto(screen.url);
      const status = response?.status() ?? 0;

      // A denial is a RENDERED page. A 404 would mean the screen threw — the
      // `/admin/seo` class — and a throw must never read as a refusal.
      expect
        .soft(
          status,
          `${screen.url} (${screen.source}) answered ${status} for a user with ` +
            "no permissions. A denial renders with 200; a 404 here means the " +
            "screen THREW, and the ReferenceError would be in the server log."
        )
        .toBe(200);

      if (status !== 200) continue;

      const denial = await page.locator(`#${screen.deniedId}`).count();
      expect
        .soft(
          denial,
          `${screen.url} (${screen.source}) did not render #${screen.deniedId} ` +
            "for a user holding zero permissions. Either the screen is showing " +
            "its contents to someone with no right to them, or its deny branch " +
            "no longer renders the hook."
        )
        .toBeGreaterThan(0);
    }
  });
});
