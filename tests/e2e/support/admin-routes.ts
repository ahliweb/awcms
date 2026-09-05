/**
 * Discover every `/admin` route from the filesystem.
 *
 * Shared by every whole-fleet admin sweep (`admin-screens-render.e2e.ts`,
 * `responsive-360.e2e.ts`, and any future one) — extracted here rather than
 * left inside `admin-screens-render.e2e.ts` because importing one `.e2e.ts`
 * file from another makes Playwright register the imported file's top-level
 * `test()` calls into the IMPORTING file's suite too. A sibling sweep that
 * imported `discoverAdminRoutes` straight from `admin-screens-render.e2e.ts`
 * would silently re-run that whole render sweep under whatever viewport/wave
 * the sibling declares — a suite it was never written for, and a duplication
 * nobody asked for. A `support/` module has no top-level `test()` calls, so
 * importing it carries no such risk.
 *
 * ## The route list is DISCOVERED, never written down
 *
 * `src/pages/admin/**.astro` is enumerated at run time. A hardcoded list is
 * the failure mode this repo keeps finding: a gate that checks its own matrix
 * rather than what exists, staying green while the thing it names drifts
 * away. Adding a screen without covering it is impossible here — the screen
 * IS the test case.
 */
import { readdirSync } from "node:fs";
import path from "node:path";

import { requiresPlatformScope } from "./admin-screen-authorize";

const HERE = path.dirname(new URL(import.meta.url).pathname);
export const ADMIN_PAGES_ROOT = path.resolve(HERE, "../../../src/pages/admin");

/**
 * A route the filesystem yielded: its URL, the source file it came from, and
 * whether entering it needs a permission no tenant owner can hold.
 */
export type AdminRoute = {
  url: string;
  source: string;
  dynamic: boolean;
  platformScoped: boolean;
};

/**
 * Every `/admin` route, derived from the pages directory.
 *
 * `index.astro` is the section root (`/admin`); a `[param]` segment is
 * reported as dynamic so the caller must supply a real value rather than
 * requesting a URL with a literal bracket in it.
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
      dynamic: url.includes("["),
      platformScoped: requiresPlatformScope(full)
    });
  }

  return routes.sort((a, b) => a.url.localeCompare(b.url));
}
