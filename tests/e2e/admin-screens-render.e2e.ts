/**
 * Every admin screen renders — the gate that would have caught `/admin/seo`.
 *
 * ## Why this exists
 *
 * `/admin/seo` answered `500` on every request and had never rendered once
 * (ADR-0112). It computed a value from three `const`s declared 130 lines below
 * it, so the component threw `ReferenceError` before emitting anything. It
 * passed review, `bun run check`, the build and CI, and shipped.
 *
 * The static half of that class is now caught by
 * `check:astro-frontmatter:check`. This is the other half. A screen can
 * type-check perfectly and still throw at render time: a `null` where a row was
 * expected, a query needing a permission row nobody seeded, a helper assuming
 * data this tenant does not have. No type system sees those.
 *
 * At the time this was written, **7 of 48 admin screens were loaded by anything
 * at all** — the CRUD specs beside this file. The other 41 were never requested
 * in CI, by any gate, in any form. `admin:screen-coverage:check` looks adjacent
 * but answers a different question — whether a screen CLAIMS a permission. It
 * never loads a page.
 *
 * ## The route list is DISCOVERED, never written down
 *
 * `src/pages/admin/**.astro` is enumerated at run time. A hardcoded list is the
 * failure mode this repo keeps finding: a gate that checks its own matrix
 * rather than what exists, staying green while the thing it names drifts away.
 * Adding a screen without covering it is impossible here — the screen IS the
 * test case.
 *
 * ## One session, soft assertions
 *
 * Logging in per screen would mean 48 logins, and a hard assertion would stop
 * at the first broken screen — so a run would reveal one defect at a time and
 * the next only after a fix. `expect.soft` checks every screen and reports all
 * failures together, which is what makes the first run after a regression
 * useful rather than merely red.
 *
 * ## What counts as a pass, and the surprise that shaped it
 *
 * The obvious assertion is "no 5xx". **It would not have caught the defect
 * this test exists for.** Reintroducing the `/admin/seo` fault and running this
 * against a real server showed the truth: when a frontmatter throws, Astro
 * serves a **404**, not a 500. The server log carries the `ReferenceError`; the
 * browser is told the page does not exist.
 *
 * That is worth stating loudly, because it means anyone hunting this class by
 * asking "which admin screens 500?" finds nothing and concludes the fleet is
 * healthy. A broken screen is indistinguishable, by status alone, from a route
 * that was never built.
 *
 * So the assertion is **`200` exactly, plus the admin shell in the body**. The
 * seeded owner holds every permission, so every admin screen owes it a rendered
 * page — there is no legitimate 403 or 404 for this user. The shell check
 * remains alongside the status because a rendered error page can carry a
 * cheerful status, and a blank 200 is not a working screen either.
 */
import { test, expect, type Page } from "@playwright/test";
import { readdirSync } from "node:fs";
import path from "node:path";

import { provideTenant } from "./support/e2e-auth";

const tenantId = process.env.E2E_TENANT_ID;
const loginIdentifier = process.env.E2E_LOGIN_IDENTIFIER;
const password = process.env.E2E_PASSWORD;

const seeded = Boolean(tenantId && loginIdentifier && password);

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ADMIN_PAGES_ROOT = path.resolve(HERE, "../../src/pages/admin");

/** A route the filesystem yielded: its URL, and the source file it came from. */
type AdminRoute = { url: string; source: string; dynamic: boolean };

/**
 * Every `/admin` route, derived from the pages directory.
 *
 * `index.astro` is the section root (`/admin`); a `[param]` segment is reported
 * as dynamic so the caller must supply a real value rather than requesting a
 * URL with a literal bracket in it.
 */
export function discoverAdminRoutes(
  root: string,
  prefix = "/admin"
): AdminRoute[] {
  const routes: AdminRoute[] = [];

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);

    if (entry.isDirectory()) {
      routes.push(...discoverAdminRoutes(full, `${prefix}/${entry.name}`));
      continue;
    }

    if (!entry.name.endsWith(".astro")) continue;

    const base = entry.name.slice(0, -".astro".length);
    const url = base === "index" ? prefix : `${prefix}/${base}`;
    routes.push({
      url,
      source: path.relative(process.cwd(), full),
      dynamic: url.includes("[")
    });
  }

  return routes.sort((a, b) => a.url.localeCompare(b.url));
}

const routes = discoverAdminRoutes(ADMIN_PAGES_ROOT);
const staticRoutes = routes.filter((route) => !route.dynamic);
const dynamicRoutes = routes.filter((route) => route.dynamic);

async function logIn(page: Page): Promise<void> {
  await page.goto("/login");
  await provideTenant(page, tenantId!);
  await page.locator("#login-identifier").fill(loginIdentifier!);
  await page.locator("#password").fill(password!);
  await page.locator("#login-submit").click();
  await page.waitForURL("**/admin");
}

/**
 * Load one admin URL and assert it rendered, SOFTLY.
 *
 * The status comes from the navigation response rather than from the DOM,
 * because a rendered error page can be served with any status the framework
 * chooses — and here it chooses 404.
 */
async function checkRenders(
  page: Page,
  url: string,
  source: string
): Promise<void> {
  const response = await page.goto(url);
  const status = response?.status() ?? 0;

  expect
    .soft(
      status,
      `${url} (${source}) answered ${status}, expected 200. The seeded owner ` +
        "holds every permission, so this screen owes it a rendered page. " +
        "A 404 here is far more likely to be a THROW during render than a " +
        "missing route: that is exactly how /admin/seo failed, and the " +
        "ReferenceError is in the SERVER log, not in this status."
    )
    .toBe(200);

  // Kept alongside the status because a rendered error page can carry a
  // cheerful status, and a blank 200 is not a working screen either. Every
  // admin screen renders through AdminLayout, so its shell is the honest
  // signal that the page got as far as producing itself.
  const shell = page.locator(".admin-shell").first();
  expect
    .soft(
      await shell.count(),
      `${url} (${source}) returned ${status} but rendered no .admin-shell.`
    )
    .toBeGreaterThan(0);
}

test.describe("every admin screen renders", () => {
  test.skip(
    !seeded,
    "requires a seeded tenant — CI e2e-smoke provisions one via POST /api/v1/setup/initialize"
  );

  test("the route walk found the screens", () => {
    // If the walk stops matching, every check below silently passes by having
    // nothing to do — the exact shape of a gate reporting success having
    // examined nothing.
    expect(
      staticRoutes.length,
      "no admin screens were discovered under src/pages/admin"
    ).toBeGreaterThan(40);
  });

  test("every static admin screen renders", async ({ page }) => {
    test.setTimeout(180_000);
    await logIn(page);

    for (const route of staticRoutes) {
      await checkRenders(page, route.url, route.source);
    }
  });

  for (const route of dynamicRoutes) {
    test(`${route.url} renders with a real id`, async ({ page }) => {
      await logIn(page);

      // The id comes from the listing screen that links to this detail page, so
      // the test uses a value the app itself considers real. Deriving beats
      // inventing: a fabricated key would 404 and prove nothing about whether
      // the screen can render.
      const listingUrl = route.url.replace(/\/\[[^\]]+\]$/, "");
      await page.goto(listingUrl);

      const href = await page
        .locator(`a[href^="${listingUrl}/"]`)
        .first()
        .getAttribute("href");

      // Failing rather than skipping is deliberate. A silent skip is how a dead
      // screen stays dead: the run goes green and nobody learns that the only
      // detail page in the section was never requested.
      expect(
        href,
        `${route.url} (${route.source}): no link under ${listingUrl}/ was ` +
          "found, so no real id could be derived. Supply one here rather than " +
          "skipping — an unrequested screen is how /admin/seo stayed broken."
      ).toBeTruthy();

      await checkRenders(page, href!, route.source);
    });
  }
});
