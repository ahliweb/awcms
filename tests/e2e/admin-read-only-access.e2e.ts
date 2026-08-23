/**
 * The operator between "owner" and "nobody": every tenant-scoped READ, and
 * nothing else.
 *
 * ## The gap
 *
 * Two sweeps already watch the extremes. `admin-screens-render.e2e.ts` loads
 * every screen as the seeded owner, who holds everything; `admin-deny-path.e2e.ts`
 * loads every screen as a user holding nothing. Neither says anything about the
 * only user shape a real deployment actually has — someone granted a job's worth
 * of permissions.
 *
 * That matters most for the screens nobody would think to check. An entry gate
 * written on a variable that happens to be `true` for the owner passes both
 * existing sweeps: the owner sees contents (expected), the empty user sees a
 * refusal (also expected). It takes a user in between for the gate's actual
 * condition to be observable.
 *
 * ## The expectation is COMPUTED, and it is two-directional
 *
 * The grant comes from the permission CATALOGUE — `scope = 'tenant' AND
 * action = 'read'` — not from any page. The expectation comes from each page's
 * own `authorize` block. So the two halves are derived from different sources
 * and the test is whether the running app agrees with both.
 *
 * `loadAdminScreen` denies an empty list and otherwise admits on ANY entry
 * request (`selectEntryOutcome`, `Array.prototype.some`), so a screen admits
 * this user exactly when at least one of its entry requests is a tenant-scoped
 * read.
 *
 * As it happens that is **every screen but two** — `/admin/tenants` and
 * `/admin/partner-registry`, which are platform-scoped (ADR-0053). That is
 * asserted explicitly rather than left implied: entering any other admin screen
 * currently costs exactly one `read`, and a screen that starts demanding
 * `configure` to be *entered* is a product decision that should turn a test red
 * and be written down, not slide in.
 *
 * ## This is where the ADR-0053 runtime check belongs, and why not the owner sweep
 *
 * `admin-screens-render.e2e.ts` cannot make this assertion. What the seeded
 * OWNER is owed by those two screens depends on whether the seeded tenant is
 * the platform tenant — its owner holds the platform permissions and sees them,
 * anyone else's owner does not. A first attempt to assert refusal there failed
 * against exactly that case.
 *
 * Here it is unconditional. The grant is filtered `scope = 'tenant'`, so this
 * user can never hold a platform permission no matter which tenant they belong
 * to, and both screens must refuse them either way. Nothing else in the repo
 * watches ADR-0053 at run time.
 *
 * ## What this does NOT prove, stated plainly
 *
 * Two things, and the first has already fooled me once in this suite:
 *
 * 1. If a screen named the WRONG permission in its `authorize` block, the
 *    expectation would be computed from that same wrong key and the test would
 *    pass. It checks that the app enforces what the screen declares; it cannot
 *    check that the declaration is right. `admin:screen-coverage:check` watches
 *    the declaration.
 * 2. It says nothing about which individual WRITE controls this user should
 *    see. Those expectations differ per screen — there is no selector all 76
 *    delegated controls share — so that is per-screen work, not one rule.
 *    Naming it here keeps the gap visible instead of assumed closed.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { test, expect } from "./support/e2e-read-wave";
import { provideTenant } from "./support/e2e-auth";
import { seedRestrictedUser } from "./support/e2e-restricted-user";
import { extractScreenAuthorizeKeys } from "./support/admin-screen-authorize";
import { platformScopedPermissionKeys } from "../../src/modules/identity-access/domain/platform-scope";

const tenantId = process.env.E2E_TENANT_ID;
const databaseUrl = process.env.DATABASE_URL;

const seeded = Boolean(tenantId && databaseUrl);

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ADMIN_PAGES_ROOT = path.resolve(HERE, "../../src/pages/admin");

type Screen = { url: string; source: string; admits: boolean };

/**
 * Every static admin screen, with what a tenant-read-only user is owed by it.
 *
 * Screens with no `authorize:` block at all are skipped: `/admin/account` loads
 * through `loadSelfServiceScreen`, where there is no permission to hold and
 * every authenticated user owns their own page.
 *
 * Dynamic routes are excluded for the same reason `admin-deny-path` excludes
 * them — a real id has to come from somewhere, and deriving one here would only
 * re-test the listing screen this file already loads.
 */
function discoverScreens(root: string, prefix = "/admin"): Screen[] {
  const platform = platformScopedPermissionKeys();
  const screens: Screen[] = [];

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);

    if (entry.isDirectory()) {
      screens.push(...discoverScreens(full, `${prefix}/${entry.name}`));
      continue;
    }

    if (!entry.name.endsWith(".astro")) continue;

    const keys = extractScreenAuthorizeKeys(readFileSync(full, "utf8"));
    if (keys.length === 0) continue;

    const base = entry.name.slice(0, -".astro".length);
    const url = base === "index" ? prefix : `${prefix}/${base}`;
    if (url.includes("[")) continue;

    screens.push({
      url,
      source: path.relative(process.cwd(), full),
      // ANY entry request suffices, so one tenant-scoped read is enough.
      admits: keys.some((key) => !platform.has(key) && key.endsWith(".read"))
    });
  }

  return screens.sort((a, b) => a.url.localeCompare(b.url));
}

const screens = discoverScreens(ADMIN_PAGES_ROOT);

// Authenticates as somebody other than the shared owner, so it must not
// inherit the session the `read` project supplies.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("admin screens for a tenant read-only operator", () => {
  test.skip(
    !seeded,
    "requires a seeded tenant and DATABASE_URL — CI e2e-smoke provides both"
  );

  test("the screen walk found them, and the refusals are the platform two", () => {
    expect(
      screens.length,
      "no admin screens with an authorize block were discovered"
    ).toBeGreaterThan(40);

    expect(
      screens.filter((screen) => !screen.admits).map((screen) => screen.url),
      "the set of screens a tenant read-only operator may NOT enter changed. " +
        "Today that is exactly the two platform-scoped screens (ADR-0053). A " +
        "new entry here means some screen now demands more than a read to be " +
        "OPENED — which may be right, but it is a product decision and it " +
        "belongs in an ADR rather than in a diff nobody reads."
    ).toEqual(["/admin/partner-registry", "/admin/tenants"]);
  });

  test("each screen either serves this user or refuses them, per its own gate", async ({
    page
  }) => {
    test.setTimeout(240_000);

    const user = await seedRestrictedUser(databaseUrl!, tenantId!, "read");

    await page.goto("/login");
    await provideTenant(page, tenantId!);
    await page.locator("#login-identifier").fill(user.loginIdentifier);
    await page.locator("#password").fill(user.password);
    await page.locator("#login-submit").click();
    await page.waitForURL("**/admin");

    for (const screen of screens) {
      const response = await page.goto(screen.url);
      const status = response?.status() ?? 0;

      // Both outcomes are rendered pages. A 404 means the screen THREW — the
      // `/admin/seo` class — and for this user specifically that is the
      // interesting failure: a `load` written against data only an owner has.
      expect
        .soft(
          status,
          `${screen.url} (${screen.source}) answered ${status} for a read-only ` +
            "operator. Both a refusal and a rendered screen are 200 here, so a " +
            "404 means it threw — and the ReferenceError is in the SERVER log, " +
            "not in this status."
        )
        .toBe(200);

      if (status !== 200) continue;

      const denials = await page.locator('[id$="-denied"]').count();

      if (screen.admits) {
        expect
          .soft(
            denials,
            `${screen.url} (${screen.source}) refused a user holding every ` +
              "tenant-scoped read, though its entry gate asks only for one. " +
              "Either the gate is checking something other than the permission " +
              "it names, or a panel inside the page is gated on a write the " +
              "screen never declared."
          )
          .toBe(0);
        continue;
      }

      expect
        .soft(
          denials,
          `${screen.url} (${screen.source}) served its contents to an ordinary ` +
            "tenant user. It is platform-scoped (ADR-0053) and enumerates data " +
            "belonging to the whole platform — this is cross-tenant disclosure."
        )
        .toBeGreaterThan(0);
    }
  });
});
