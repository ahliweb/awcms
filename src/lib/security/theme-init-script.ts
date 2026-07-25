/**
 * Theme-flash-prevention script body — the ONLY inline script in this repo,
 * adapted from awcms-micro's `src/lib/security/theme-init-script.ts` as part of
 * the admin-shell parity work.
 *
 * WHY AN INLINE SCRIPT AT ALL, GIVEN THIS REPO'S CSP POSTURE
 *
 * `src/lib/security/security-headers.ts` owns a single `default-src 'self'`
 * policy with NO `'unsafe-inline'`, and `astro.config.mjs` deliberately does
 * NOT enable Astro's own `security.csp` (two CSP owners = drift). Every other
 * client script in this repo is therefore an Astro-bundled EXTERNAL module,
 * which passes `'self'` without any hash bookkeeping.
 *
 * This one cannot be. It must run synchronously in `<head>`, before the body
 * paints, or the admin shell renders in the wrong theme for a frame and then
 * snaps — the classic theme flash. Astro-bundled scripts are `type="module"`
 * and therefore deferred, which reintroduces exactly that flash. So this script
 * is `is:inline` (opting OUT of Astro's processing) and its SHA-256 is
 * registered explicitly in the CSP's `script-src`.
 *
 * A hash is NOT a relaxation the way `'unsafe-inline'` would be: it authorises
 * these exact bytes and nothing else. Change one character below without
 * updating `THEME_INIT_SCRIPT_HASH` and the browser silently refuses to run it
 * — `tests/theme-init-script.test.ts` asserts the two stay in sync so that
 * failure surfaces in CI instead of as a theme flash nobody notices.
 *
 * WHY THE DEFAULT COMES FROM AN HTML ATTRIBUTE, NOT `define:vars`
 *
 * The body reads its fallback from `data-tenant-default-theme` on `<html>`
 * rather than interpolating a server value into the script text. Server
 * interpolation would make the rendered bytes vary per request/tenant, so a
 * single static hash could only ever match one variant and would silently
 * block all the others. Reading an attribute keeps the bytes constant forever,
 * which is what makes one hash correct for every tenant.
 *
 * awcms has no per-tenant default-theme column today (awcms-micro's
 * `default_theme` on its tenants table has no counterpart here), so
 * `AdminLayout.astro` does not set that attribute and the script falls back to
 * `"system"`. The attribute read is kept anyway: it is the seam that lets a
 * future tenant default land WITHOUT touching these bytes or the hash.
 */
export const THEME_INIT_SCRIPT_BODY = `(function () {
  var STORAGE_KEY = "awcms_theme";
  var tenantDefaultTheme =
    document.documentElement.getAttribute("data-tenant-default-theme") ||
    "system";
  var stored = localStorage.getItem(STORAGE_KEY) || tenantDefaultTheme;
  var resolved =
    stored === "light" || stored === "dark"
      ? stored
      : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
  document.documentElement.setAttribute("data-theme", resolved);
})();`;

/**
 * SHA-256 of `THEME_INIT_SCRIPT_BODY`, in the `sha256-<base64>` form CSP's
 * `script-src` expects. Recomputed for awcms — the body's `STORAGE_KEY` is
 * `awcms_theme`, not awcms-micro's `awcms_micro_theme`, so awcms-micro's hash
 * does not match these bytes and carrying it over would have blocked the very
 * script that prevents the flash. Kept honest by `tests/theme-init-script.test.ts`.
 */
export const THEME_INIT_SCRIPT_HASH =
  "sha256-lOc2GAiS/8scFxSOam/Qp0WAZJ9iWtVPpAe0h4d3eDE=";

/** Storage key the toggle writes and this script reads. Single source of truth. */
export const THEME_STORAGE_KEY = "awcms_theme";
