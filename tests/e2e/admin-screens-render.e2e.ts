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
 * shell check remains alongside the status because a rendered error page can
 * carry a cheerful status, and a blank 200 is not a working screen either.
 *
 * ## `200` alone was not enough, and that was a real weakness
 *
 * A DENIED screen also answers `200` — denial renders here, it never redirects
 * (`src/lib/auth/admin-screen.ts`). So the original version of this sweep would
 * have stayed green if a screen started refusing the owner: if a module were
 * switched off, if a grant were dropped from the blanket bootstrap, if a `deny`
 * policy were authored tenant-wide. It was accidentally immune rather than
 * correct.
 *
 * It now asserts the screen rendered its CONTENTS — no denial hook anywhere in
 * the page — for every screen the owner is owed one. That could not be done
 * while `admin-modules-toggle.e2e.ts` might be running concurrently: it
 * disables `reporting`, `/admin` authorizes on `reporting.dashboard.read`, and
 * a correct denial would have read as a defect. The read/write waves
 * (`tests/e2e/support/e2e-waves.ts`) are what make this assertion possible.
 *
 * ## Two screens are exempt, and the reason is not a shrug
 *
 * `/admin/tenants` and `/admin/partner-registry` are platform-scoped
 * (ADR-0053): they enumerate every tenant and every partnership on the
 * platform. What the seeded owner is owed by them depends on WHICH tenant was
 * seeded — the platform tenant's owner holds those permissions and sees the
 * screens; any other tenant's owner is refused. This spec has no independent
 * way to know which it is looking at, and a first attempt that assumed "ordinary
 * tenant" failed against a local environment where the seeded tenant IS the
 * platform tenant. Asserting either outcome would encode an assumption about
 * the fixture rather than a property of the product.
 *
 * So they are held to `200` + shell here, and the real ADR-0053 runtime check
 * lives in `admin-read-only-access.e2e.ts`, where it is unconditional: a user
 * granted every TENANT-scoped read can never hold a platform permission, so
 * both screens must refuse them whichever tenant they are in.
 *
 * Which screens those are is not written down; it is computed from each page's
 * own `authorize` block against the module registry's platform set
 * (`support/admin-screen-authorize.ts`), and the resulting set is asserted so a
 * third one appearing is a decision rather than a surprise.
 */
import { test, expect, type Page } from "./support/e2e-read-wave";

import { discoverAdminRoutes, ADMIN_PAGES_ROOT } from "./support/admin-routes";

const tenantId = process.env.E2E_TENANT_ID;
const loginIdentifier = process.env.E2E_LOGIN_IDENTIFIER;
const password = process.env.E2E_PASSWORD;

const seeded = Boolean(tenantId && loginIdentifier && password);

/**
 * What the seeded owner is owed by a screen.
 *
 * `either` is for the platform-scoped pair, where the answer depends on whether
 * the seeded tenant is the platform tenant — see the header. They still get the
 * status and shell checks; only the contents-vs-refusal question is left open.
 */
type Expectation = "contents" | "either";

const routes = discoverAdminRoutes(ADMIN_PAGES_ROOT);
const staticRoutes = routes.filter((route) => !route.dynamic);
const dynamicRoutes = routes.filter((route) => route.dynamic);

/**
 * Load one admin URL and assert the owner got what that screen owes them,
 * SOFTLY.
 *
 * The status comes from the navigation response rather than from the DOM,
 * because a rendered error page can be served with any status the framework
 * chooses — and here it chooses 404.
 */
async function checkRenders(
  page: Page,
  url: string,
  source: string,
  expected: Expectation = "contents"
): Promise<void> {
  const response = await page.goto(url);
  const status = response?.status() ?? 0;

  // Both outcomes are `200`: a refusal is a rendered page here, not an error.
  // So the status separates "the screen produced something" from "the screen
  // threw", and the DOM below separates contents from refusal.
  expect
    .soft(
      status,
      `${url} (${source}) answered ${status}, expected 200. ` +
        "A 404 here is far more likely to be a THROW during render than a " +
        "missing route: that is exactly how /admin/seo failed, and the " +
        "ReferenceError is in the SERVER log, not in this status."
    )
    .toBe(200);

  if (status !== 200) return;

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

  if (expected === "either") return;

  // Denial renders an element carrying `id="…-denied"` — never a redirect, so
  // the DOM is the only place the outcome shows. Counting ANY such hook rather
  // than one known id also covers the sub-panel gates (`/admin/seo` has four),
  // so a screen that renders while quietly refusing half of itself to the owner
  // is caught too.
  const denials = await page.locator('[id$="-denied"]').count();

  expect
    .soft(
      denials,
      `${url} (${source}) refused the seeded owner, who holds every ` +
        "tenant-scoped permission. Something removed a grant, disabled the " +
        "module behind this screen, or authored a tenant-wide deny policy. " +
        "(If this screen is meant to be platform-only, it must say so in its " +
        "own `authorize` block — that is where the expectation comes from.)"
    )
    .toBe(0);
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

    // The same hazard one level down: if the `authorize` extractor stopped
    // matching, every screen would be classed "tenant-scoped" and the sweep
    // would demand contents from the two platform screens — loudly wrong, so
    // that direction is self-announcing. The quiet direction is the opposite,
    // and this is what watches it. A THIRD platform screen appearing should be
    // a decision, not a surprise.
    const platform = staticRoutes
      .filter((route) => route.platformScoped)
      .map((route) => route.url)
      .sort();

    expect(
      platform,
      "the set of platform-scoped admin screens changed. ADR-0053 screens " +
        "enumerate data belonging to the whole platform, and a tenant owner " +
        "must be refused by them. If this is intended, update the list here " +
        "deliberately; if it is not, a screen just claimed — or stopped " +
        "claiming — cross-tenant authority."
    ).toEqual(["/admin/partner-registry", "/admin/tenants"]);
  });

  test("every static admin screen renders", async ({ page }) => {
    test.setTimeout(180_000);
    // Already authenticated as the owner: the `setup` project logged in once
    // and this project reuses that session. See `tests/e2e/auth.setup.ts`.

    for (const route of staticRoutes) {
      await checkRenders(
        page,
        route.url,
        route.source,
        route.platformScoped ? "either" : "contents"
      );
    }
  });

  for (const route of dynamicRoutes) {
    test(`${route.url} renders with a real id`, async ({ page }) => {
      // Already authenticated as the owner: the `setup` project logged in once
      // and this project reuses that session. See `tests/e2e/auth.setup.ts`.

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
