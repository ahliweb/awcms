/**
 * Automated accessibility smoke — `@axe-core/playwright` over representative
 * admin routes changed by epic #858, in both themes and at two viewports.
 *
 * ## Why this exists
 *
 * #858's acceptance criteria required "no critical/serious
 * `@axe-core/playwright` findings" on every route its waves touched
 * (`.admin-status-pill`, `.admin-timeline`, `.admin-stat-card`, the shared
 * media/comments primitives, the ADR-0125 dialogs), but no axe harness ever
 * existed under `tests/e2e/` — the criterion could not be measured while
 * waves 1–7 landed (reported honestly in PR #876). This spec is that harness
 * (Issue #877, epic #858).
 *
 * ## Scope
 *
 * Eight representative routes: the dashboard, a moderation queue
 * (`.admin-bulk-bar` + confirm dialog), a `.admin-status-pill` list screen
 * (`/admin/users`), a `.admin-timeline` screen (`/admin/approvals`), the
 * media grid (`ReasonPanel` delete), the OMES control-center index, one OMES
 * detail screen (`/admin/omes/jobs`), and a settings screen with the
 * `SettingsSaveBar` (`/admin/site-profile`). Each is scanned in light AND
 * dark theme, at 360px (narrowest real phone width, matching
 * `responsive-360.e2e.ts`) and desktop (the `read` project's native
 * 1280x720), against the WCAG 2.0 A/AA and 2.1 A/AA rule sets. A run fails on
 * any `critical`/`serious` violation; `moderate`/`minor` are informational
 * only (axe itself, not this repo, decides what belongs in which bucket).
 *
 * `ConfirmDialog` and `ReasonPanel` (ADR-0125) are scanned separately, each
 * OPENED THROUGH A REAL BUTTON on a page where doing so performs no
 * mutation: `/admin/offices`' delete button for the confirm dialog (the
 * seeded head office row always exists — the same fixture
 * `admin-offices.e2e.ts` relies on) and `/admin/modules`' disable button for
 * the reason panel (a non-core module is enabled by default in every fresh
 * tenant). Both are cancelled rather than submitted, so this spec never
 * performs a mutation through the app — required by its READ_WAVE
 * classification (`support/e2e-read-wave.ts` fails the test otherwise). A
 * moderation-queue confirm dialog would have needed seeded comment rows this
 * spec does not create; the offices/modules pair needs no fixture at all.
 *
 * ## Theme switching: the app's real mechanism, not a stub
 *
 * `src/lib/security/theme-init-script.ts` resolves the active theme from
 * `localStorage["awcms_theme"]` on every page load (an inline, CSP-hashed
 * script that runs before first paint). This spec sets that same key through
 * `page.evaluate` after establishing the app's origin with one navigation,
 * then reloads — the identical mechanism a real operator's click on
 * `ThemeToggle.astro` drives (`src/lib/ui/theme-toggle-client.ts` writes the
 * same key). No CSS override, no `prefers-color-scheme` emulation standing in
 * for the real switch.
 *
 * ## Why READ_WAVE
 *
 * Every scan is a `page.goto` plus, for the two dialog cases, opening and
 * then CANCELLING a dialog. Nothing here changes tenant state through the
 * app, so it belongs beside `responsive-360.e2e.ts` and the other read-only
 * sweeps rather than in WRITE_WAVE — see `tests/e2e/support/e2e-waves.ts`.
 */
import AxeBuilder from "@axe-core/playwright";

import { test, expect, type Page } from "./support/e2e-read-wave";

import { THEME_STORAGE_KEY } from "../../src/lib/security/theme-init-script";

/** WCAG 2.0 and 2.1, levels A and AA — the tag set the issue asked for. */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] as const;

/** axe impact levels that fail the build; `moderate`/`minor` are reported, not blocking. */
const BLOCKING_IMPACTS = new Set(["critical", "serious"]);

const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];

const VIEWPORTS = [
  { label: "360px", width: 360, height: 640 },
  { label: "desktop", width: 1280, height: 800 }
] as const;

/** Representative routes changed by epic #858 (issue #877's explicit list). */
const ROUTES = [
  { path: "/admin", label: "dashboard" },
  { path: "/admin/comments", label: "comments moderation queue" },
  { path: "/admin/users", label: "users (.admin-status-pill list)" },
  { path: "/admin/approvals", label: "approvals (.admin-timeline)" },
  { path: "/admin/media", label: "media" },
  { path: "/admin/omes", label: "OMES control centre index" },
  { path: "/admin/omes/jobs", label: "OMES jobs (detail screen)" },
  { path: "/admin/site-profile", label: "site profile (SettingsSaveBar)" },
  // Issue #894 — the two screens that flipped `inventory` and `tax` to `active`.
  // Both are multi-form and table-heavy, which is where contrast and label
  // defects have collected before.
  { path: "/admin/inventory", label: "inventory (balances view)" },
  {
    path: "/admin/inventory?view=movements",
    label: "inventory (movements + adjust/transfer forms)"
  },
  { path: "/admin/tax", label: "tax (rule profiles + draft form)" },
  { path: "/admin/tax?view=report", label: "tax (reconciliation form)" },
  // Issue #905 — the screen that flipped `procurement` to `active`.
  {
    path: "/admin/procurement",
    label: "procurement (suppliers + create form)"
  },
  {
    path: "/admin/procurement?view=documents",
    label: "procurement (documents + line editor)"
  },
  { path: "/admin/procurement?view=policy", label: "procurement (policy form)" }
] as const;

const tenantId = process.env.E2E_TENANT_ID;
const loginIdentifier = process.env.E2E_LOGIN_IDENTIFIER;
const password = process.env.E2E_PASSWORD;
const seeded = Boolean(tenantId && loginIdentifier && password);

/**
 * One human-readable line per offending node, e.g.:
 * `color-contrast [serious] target=".admin-status-pill" — Elements must have
 * sufficient colour contrast — help: https://…`
 */
function describeViolations(violations: import("axe-core").Result[]): string[] {
  const lines: string[] = [];

  for (const violation of violations) {
    for (const node of violation.nodes) {
      lines.push(
        `${violation.id} [${violation.impact ?? "unknown"}] ` +
          `target=${JSON.stringify(node.target)} — ${violation.help} ` +
          `(${violation.helpUrl})`
      );
    }
  }

  return lines;
}

/**
 * Run axe against the current page/state and soft-assert no blocking
 * violation. `expect.soft` (not a hard assertion) so one broken screen does
 * not hide every other one in the same run — the same reporting shape
 * `admin-screens-render.e2e.ts` and `responsive-360.e2e.ts` use for their
 * fleet sweeps.
 */
async function scanForViolations(page: Page, context: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags([...WCAG_TAGS])
    .analyze();

  const blocking = results.violations.filter(
    (v) => v.impact && BLOCKING_IMPACTS.has(v.impact)
  );

  const lines = describeViolations(blocking);

  expect
    .soft(
      lines,
      `${context}: ${blocking.length} critical/serious axe violation(s):\n` +
        lines.map((l) => `  - ${l}`).join("\n")
    )
    .toEqual([]);
}

/**
 * Set `localStorage[THEME_STORAGE_KEY]` on the app's own origin, then reload
 * so the inline init script (`theme-init-script.ts`) resolves `data-theme`
 * from the new value — the exact mechanism a real click on `ThemeToggle`
 * drives, just without the click.
 */
async function setTheme(page: Page, theme: Theme): Promise<void> {
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [
    THEME_STORAGE_KEY,
    theme
  ] as const);

  await page.evaluate((expected) => {
    // Sanity check inside the browser context: fail loudly rather than scan
    // a page that silently kept the previous theme.
    if (localStorage.getItem("awcms_theme") !== expected) {
      throw new Error("theme storage key mismatch after setTheme");
    }
  }, theme);
}

test.describe("admin a11y smoke (axe-core, WCAG 2.0/2.1 A+AA)", () => {
  test.skip(
    !seeded,
    "requires a seeded tenant — CI e2e-smoke provisions one via POST /api/v1/setup/initialize"
  );

  // `src/styles/motion.css`'s `.fade-in-up` entrance (240ms, applied to every
  // `.admin-section`) genuinely reduces `opacity` on its ancestor while it
  // plays, and axe samples RENDERED pixel colour rather than trusting
  // computed style — a scan that lands mid-animation reports a real but
  // transient contrast dip on everything inside (measured directly while
  // diagnosing this spec: an ancestor `opacity: 0.617` mid-fade turned a
  // 5.19:1 token pair into 3.11:1). That is not what this spec means to
  // measure: a user does not perceive the 240ms transition as the page's
  // steady state, and rescanning after every `page.goto` would make the run
  // both slow and non-deterministic (how long the animation has run at
  // scan-time depends on machine speed). `reducedMotion: "reduce"` uses the
  // app's OWN already-implemented WCAG 2.3.3 mode (`motion.css`'s
  // `@media (prefers-reduced-motion: reduce)` block sets `opacity: 1
  // !important` with no animation) rather than an ad hoc wait/sleep — every
  // scan below runs against the same settled state a reduced-motion user
  // always sees.
  test.use({ reducedMotion: "reduce" });

  test("representative admin routes have no critical/serious axe violations in light and dark theme, at 360px and desktop", async ({
    page
  }) => {
    test.setTimeout(600_000);

    // Establish the app's origin first (localStorage is origin-scoped and
    // cannot be set before any navigation has happened), then start driving
    // the real theme mechanism for every subsequent load.
    await page.goto(ROUTES[0]!.path);

    for (const theme of THEMES) {
      await setTheme(page, theme);

      for (const route of ROUTES) {
        for (const viewport of VIEWPORTS) {
          await page.setViewportSize(viewport);

          const response = await page.goto(route.path);
          const status = response?.status() ?? 0;

          // Axe has nothing meaningful to scan on a page that never painted,
          // but skipping silently would let a broken route turn this sweep
          // vacuous — a render that throws is a 404 here, not a 500. So a
          // non-200 is a soft failure of its own, then the scan is skipped.
          expect
            .soft(status, `${route.path} (${theme}, ${viewport.label})`)
            .toBe(200);
          if (status !== 200) continue;

          await scanForViolations(
            page,
            `${route.path} (${route.label}, ${theme} theme, ${viewport.label})`
          );
        }
      }
    }
  });

  test("the ADR-0125 ConfirmDialog has no critical/serious axe violations while open (opened then cancelled, no mutation)", async ({
    page
  }) => {
    test.setTimeout(60_000);

    // /admin/offices always has the seeded head office row (the same
    // fixture `admin-offices.e2e.ts` depends on), so its delete button is a
    // reliable, no-fixture-required way to open the shared confirm dialog.
    await page.goto("/admin/offices");

    const deleteButton = page.locator(".office-delete-btn").first();
    await expect(deleteButton).toBeVisible();
    await deleteButton.click();

    const dialog = page.locator("#confirm-dialog");
    await expect(dialog).toBeVisible();

    await scanForViolations(page, "#confirm-dialog (open, /admin/offices)");

    // Cancel — never confirm. No DELETE request is ever sent.
    await page.locator("#confirm-dialog-cancel").click();
    await expect(dialog).toBeHidden();
  });

  test("the ADR-0125 ReasonPanel has no critical/serious axe violations while open (opened then cancelled, no mutation)", async ({
    page
  }) => {
    test.setTimeout(60_000);

    // /admin/modules always has at least one enabled, non-core module (every
    // fresh tenant ships with e.g. blog-content/theming/media-library
    // enabled), so its "Disable" button reliably opens the shared reason
    // panel with no fixture of its own.
    await page.goto("/admin/modules");

    const disableButton = page
      .locator(".module-toggle[data-reason-action]")
      .first();
    await expect(disableButton).toBeVisible();
    await disableButton.click();

    const panel = page.locator("[data-reason-panel]");
    await expect(panel).toBeVisible();

    await scanForViolations(page, "reason panel (open, /admin/modules)");

    // Cancel — never submit. No PATCH/POST request is ever sent.
    await page.locator("[data-reason-panel-cancel]").click();
    await expect(panel).toBeHidden();
  });
});
