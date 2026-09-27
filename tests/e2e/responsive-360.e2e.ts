/**
 * Every static admin screen fits a 360px-wide viewport, AND a 1024px-wide one.
 *
 * ## The gap this closes
 *
 * `grep -rn "viewport" tests/e2e/` returned nothing before this file: the
 * entire suite runs at `devices["Desktop Chrome"]` (1280×720). No admin
 * screen has ever been loaded at a phone width, so "the admin surface works
 * on mobile" has been an unverified claim, not a checked one. 360px is the
 * target because it is the narrowest width in real use — a screen that fits
 * 360 fits 375/390 too, but the reverse does not hold.
 *
 * ## 1024px joined it for ahliweb/awcms#843
 *
 * 1024px is not a phone width — it is where `.admin-brand-cluster` widens
 * to line up with the (now fixed-position) sidebar AND, one pixel below,
 * where `.admin-palette-open`/`.admin-tenant-switch` are still both shown
 * (they only hide BELOW 1024, per the `@media (max-width: 1023.98px)` rule
 * this fix widened to `1024px`). That combination briefly made every topbar
 * control visible at once while the brand cluster also claimed its widest
 * reserved space, and `.admin-user-menu` had no floor of its own
 * (`min-width: 0`) to stop the flex-shrink algorithm from squeezing it below
 * `.admin-account-link`'s real content width — so the account link rendered
 * at its natural size regardless and spilled out of its shrunken parent,
 * widening `document.documentElement` by ~55–66px on every admin screen
 * (reproducible on a short page, so it was never about page content). See
 * `.changeset/` and `src/styles/admin.css` for the fix. 1024px is added as a
 * SECOND width in the same sweep — not a new file — because the property
 * under test ("no admin screen scrolls sideways") is identical; only the
 * viewport differs.
 *
 * ## Why this is a sibling of `admin-screens-render.e2e.ts`, not a change to it
 *
 * That sweep already discovers every admin route and loads each one as the
 * seeded owner; this one wants the exact same route list at a different
 * viewport. Importing `discoverAdminRoutes` from that FILE rather than from
 * `support/admin-routes.ts` would have made Playwright register that file's
 * top-level `test()` calls into this file's suite too — the whole render
 * sweep would then re-run under a 360px viewport it was never written for.
 * `discoverAdminRoutes` was moved to `support/admin-routes.ts` for exactly
 * this reason: a `support/` module has no top-level tests, so importing it
 * carries none of that risk.
 *
 * Only STATIC routes are swept. A `[param]` route has no real id to request
 * without first visiting a listing page to derive one (see how the render
 * sweep does it for `dynamicRoutes`) — duplicating that machinery here would
 * buy no new coverage of the property this file checks, since a detail page
 * uses the same layout primitives as its listing.
 *
 * ## The assertion: no sideways scroll, not a screenshot diff
 *
 * `document.documentElement.scrollWidth <= innerWidth` (plus 1px of slack for
 * sub-pixel rounding) is the property that actually matters at any width: if
 * the document is wider than the viewport, the user can drag the whole page
 * sideways, which on real admin UI usually means a table, a flex item with no
 * floor of its own, or a fixed-width element was not made to fit. A
 * screenshot diff would need a baseline per screen and would go red on every
 * copy change; this does not, and it is objectively true or false rather than
 * "looks different".
 *
 * A bare `false` is a useless failure message, so on overflow this also
 * collects which elements caused it — tag name, id/class if present, and the
 * measured right edge — capped at 5 so the message stays readable instead of
 * dumping the whole DOM.
 *
 * Like the render sweep, this uses `expect.soft` per route: a hard assertion
 * would stop at the first broken screen, and the point of a fleet sweep is to
 * report every broken one in a single run rather than one per fix cycle.
 *
 * ## No platform-scope exemption — and that is deliberate
 *
 * The render sweep exempts `/admin/tenants` and `/admin/partner-registry`
 * from its CONTENTS assertion, because what the seeded owner is owed there
 * (contents vs. a refusal) depends on which tenant happened to be seeded —
 * that is a fact about the fixture, not about the product. Horizontal
 * overflow has no such ambiguity: a refusal page is rendered HTML same as a
 * contents page, and it must not scroll sideways either. So this sweep
 * covers all static routes, platform-scoped ones included, with no
 * exemption.
 *
 * ## The viewport override
 *
 * The `read` project supplies `devices["Desktop Chrome"]` (1280×720) plus a
 * logged-in `storageState`; the session is inherited, the screen size is not.
 * Each width gets its own `test()` that calls `page.setViewportSize()`
 * directly (rather than a file-level `test.use({ viewport })`, which can only
 * express one fixed size for the whole file) — the same per-test override
 * pattern `admin-sidebar-long-content.e2e.ts` uses for the same reason.
 */
import { test, expect, type Page } from "./support/e2e-read-wave";

import { discoverAdminRoutes, ADMIN_PAGES_ROOT } from "./support/admin-routes";

// 360 (narrowest real phone width) and 1024 (ahliweb/awcms#843 — the exact
// width where the topbar's account link overflowed on every admin screen).
// Each gets its own `test()` below via `page.setViewportSize`, rather than a
// file-level `test.use({ viewport })`, because that API can only express one
// fixed viewport for the whole file/describe.
const VIEWPORT_WIDTHS = [360, 1024] as const;
const OVERFLOW_TOLERANCE_PX = 1;
const MAX_REPORTED_OFFENDERS = 5;

const tenantId = process.env.E2E_TENANT_ID;
const loginIdentifier = process.env.E2E_LOGIN_IDENTIFIER;
const password = process.env.E2E_PASSWORD;

const seeded = Boolean(tenantId && loginIdentifier && password);

const routes = discoverAdminRoutes(ADMIN_PAGES_ROOT).filter(
  (route) => !route.dynamic
);

/** One element whose right edge sticks out past the viewport. */
type Offender = {
  tag: string;
  identity: string;
  right: number;
};

/**
 * Collect up to `MAX_REPORTED_OFFENDERS` elements whose
 * `getBoundingClientRect().right` exceeds the viewport width, so a failure
 * message names actual culprits rather than just a scrollWidth number.
 */
async function findOverflowOffenders(
  page: Page,
  viewportWidth: number,
  limit: number
): Promise<Offender[]> {
  return page.evaluate(
    ({ viewportWidth, limit }) => {
      const offenders: { tag: string; identity: string; right: number }[] = [];

      for (const el of document.querySelectorAll("body *")) {
        if (offenders.length >= limit) break;

        const rect = el.getBoundingClientRect();
        if (rect.right <= viewportWidth) continue;

        const id = el.id ? `#${el.id}` : "";
        const cls =
          typeof el.className === "string" && el.className.trim()
            ? `.${el.className.trim().split(/\s+/).join(".")}`
            : "";

        offenders.push({
          tag: el.tagName.toLowerCase(),
          identity: `${id}${cls}`,
          right: Math.round(rect.right)
        });
      }

      return offenders;
    },
    { viewportWidth, limit }
  );
}

test.describe("every static admin screen fits its target viewport", () => {
  test.skip(
    !seeded,
    "requires a seeded tenant — CI e2e-smoke provisions one via POST /api/v1/setup/initialize"
  );

  test("the route walk found the screens", () => {
    // Same guard as the render sweep: if the walk stops matching, every check
    // below silently passes by having nothing to do.
    expect(
      routes.length,
      "no static admin screens were discovered under src/pages/admin"
    ).toBeGreaterThan(40);
  });

  for (const width of VIEWPORT_WIDTHS) {
    test(`no static admin screen scrolls sideways at ${width}px`, async ({
      page
    }) => {
      test.setTimeout(180_000);
      // Already authenticated as the owner: the `setup` project logged in
      // once and this project reuses that session. See
      // `tests/e2e/auth.setup.ts`.
      await page.setViewportSize({ width, height: 640 });

      for (const route of routes) {
        const response = await page.goto(route.url);
        const status = response?.status() ?? 0;

        // A screen that fails to render at all is out of scope here —
        // `admin-screens-render.e2e.ts` is what asserts status/contents. This
        // file only has an opinion about width, and a non-200 page has no
        // meaningful width to assert about.
        if (status !== 200) continue;

        const scrollWidth = await page.evaluate(
          () => document.documentElement.scrollWidth
        );

        if (scrollWidth <= width + OVERFLOW_TOLERANCE_PX) continue;

        const offenders = await findOverflowOffenders(
          page,
          width,
          MAX_REPORTED_OFFENDERS
        );
        const offenderList = offenders
          .map((o) => `<${o.tag}${o.identity}> right=${o.right}px`)
          .join(", ");

        expect
          .soft(
            scrollWidth,
            `${route.url} (${route.source}) scrolls sideways at ${width}px: ` +
              `document.documentElement.scrollWidth is ${scrollWidth}px. ` +
              (offenders.length > 0
                ? `Elements sticking out past ${width}px: ${offenderList}.`
                : "No single element was found past the edge — the overflow " +
                  "may come from a combination (e.g. flex/grid children) " +
                  "rather than one element.")
          )
          .toBeLessThanOrEqual(width + OVERFLOW_TOLERANCE_PX);
      }
    });
  }
});
