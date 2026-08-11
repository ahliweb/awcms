#!/usr/bin/env bun
/**
 * `bun run modules:routes:check` — Issue #256.
 *
 * Every file under `src/pages` resolves to exactly ONE owning module, or is
 * named in a reviewed allow-list. No route belongs to nobody; no route belongs
 * to two modules.
 *
 * ## Why ownership was not derivable before
 *
 * `ModuleApiContract.basePath` was the only ownership claim in the descriptor,
 * and `tenant_admin` declared `basePath: "/api/v1"` — a prefix of every route
 * in the application. Resolving by longest-matching `basePath` handed it 36
 * routes it does not own (all of `/api/v1/{access,roles,users,abac,identity}`,
 * which are `identity_access`, plus `/api/v1/tenant/modules`, which is
 * `module_management`), while 30 further routes — the public blog, the
 * discovery endpoints, `/search`, the theming CSS — matched nothing at all.
 *
 * So `api.routes` (a LIST, longest-prefix wins) now carries ownership and this
 * gate keeps the mapping total and unambiguous.
 *
 * ## What is deliberately not here
 *
 * `/admin/**` pages. `tests/admin-navigation-registry.test.ts` already binds
 * every admin page to exactly one descriptor's `navigation` entry, in both
 * directions. Claiming them here too would be a second, drifting source for the
 * same fact — the defect that gate was written to remove.
 *
 * Pure: reads `listModules()` and walks `src/pages`. No database, no network.
 */
import { readdir } from "node:fs/promises";
import path from "node:path";

import { listModules } from "../src/modules";

const PAGES_ROOT = "src/pages";

/**
 * Prefixes that can never be an ownership claim because they prefix the whole
 * application. Rejected explicitly: a coverage-only gate cannot see them, since
 * a prefix that matches everything leaves nothing uncovered.
 */
const OVERBROAD_PREFIXES = new Set(["/", "/api", "/api/v1"]);

/**
 * Routes owned by the platform rather than by any module. Each needs a reason a
 * reviewer can disagree with — an entry without one is worse than no gate.
 */
const PLATFORM_ROUTES: readonly { route: string; reason: string }[] = [
  {
    route: "/api/v1/health",
    reason:
      "Liveness for the process, not for a module. Unauthenticated by the same " +
      "precedent as /api/v1/database/pool/health, and exposes only aggregate " +
      "booleans — a module owning it would imply it can be disabled, which " +
      "would take the health endpoint down with it."
  },
  {
    route: "/api/v1/database/pool/health",
    reason:
      "Pool/circuit-breaker counters for THIS process. Belongs to the database " +
      "subsystem in src/lib, which is infrastructure and deliberately not a module."
  },
  {
    route: "/[...path]",
    reason:
      "Astro's lowest-ranked catch-all: it runs only when no real route matched, " +
      "so by construction it is the absence of a module rather than one module's " +
      "surface. Renders the generic 404 (HTML for browsers, the standard JSON " +
      "envelope for /api/*)."
  },
  {
    route: "/index",
    reason:
      "The deployment domain's front door (ADR-0083), which is the platform's " +
      "surface and not any module's: it renders from constants alone — no " +
      "database query, no tenant context, no module state — precisely so that " +
      "the root cannot break when a module is disabled or a tenant fails to " +
      "resolve. Giving it to a module would make the front door disableable, " +
      "which is the failure (a 404 at the root) this page exists to fix."
  }
];

/** `src/pages/blog/[tenantCode]/[slug].ts` -> `/blog/[tenantCode]/[slug]`. */
export function routeOf(filePath: string): string {
  return (
    "/" +
    filePath
      .replace(/^src\/pages\/?/, "")
      .replace(/\.(ts|astro|js)$/, "")
      .replace(/\/index$/, "")
      .replace(/^\//, "")
  );
}

export type RouteOwnership = {
  /** Prefix -> owning module key. Longest prefix wins. */
  claims: { prefix: string; moduleKey: string }[];
  /** Two modules claiming the same prefix — always a defect. */
  conflicts: string[];
};

export function collectClaims(
  modules: readonly {
    key: string;
    api?: { basePath: string; routes?: string[]; openApiPath?: string };
  }[]
): RouteOwnership {
  const byPrefix = new Map<string, string[]>();

  for (const module of modules) {
    if (!module.api) {
      continue;
    }

    for (const prefix of module.api.routes ?? [module.api.basePath]) {
      byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), module.key]);
    }
  }

  const conflicts: string[] = [];
  const claims: { prefix: string; moduleKey: string }[] = [];

  // An over-broad prefix is the ORIGINAL defect, and it is invisible to the
  // "every route has an owner" rule: `/api/v1` gives every route an owner, so
  // the coverage check goes green while the answers are wrong. It has to be
  // rejected on its own terms.
  for (const [prefix, owners] of byPrefix) {
    if (OVERBROAD_PREFIXES.has(prefix)) {
      conflicts.push(
        `"${prefix}" (declared by ${owners.join(", ")}) is too broad to be an ` +
          "ownership claim — it prefixes routes belonging to other modules, which " +
          "is exactly how `tenant_admin` came to own 36 routes it does not. List " +
          "the specific prefixes in `api.routes` instead."
      );
    }
  }

  for (const [prefix, owners] of byPrefix) {
    if (owners.length > 1) {
      conflicts.push(`"${prefix}" is claimed by ${owners.sort().join(", ")}.`);
      continue;
    }

    claims.push({ prefix, moduleKey: owners[0]! });
  }

  // Longest first: `/api/v1/tenant/modules` must beat `/api/v1/tenant/domains`'
  // sibling and any shorter prefix, which is what makes a SPLIT tree resolve
  // without special cases.
  claims.sort((a, b) => b.prefix.length - a.prefix.length);

  return { claims, conflicts };
}

export function resolveOwner(
  route: string,
  claims: readonly { prefix: string; moduleKey: string }[]
): string | null {
  return (
    claims.find((claim) => route.startsWith(claim.prefix))?.moduleKey ?? null
  );
}

async function* walk(directory: string): AsyncGenerator<string> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (/\.(ts|astro)$/.test(entry.name)) {
      yield full;
    }
  }
}

async function main(): Promise<void> {
  const modules = listModules();
  const { claims, conflicts } = collectClaims(modules);
  const platform = new Set(PLATFORM_ROUTES.map((entry) => entry.route));
  const problems: string[] = [...conflicts];

  for (const entry of PLATFORM_ROUTES) {
    if (entry.reason.trim().length < 40) {
      problems.push(`${entry.route} is exempt with no substantive reason.`);
    }
  }

  let scanned = 0;
  let unowned = 0;

  for await (const file of walk(PAGES_ROOT)) {
    const filePath = file.split(path.sep).join("/");
    const route = routeOf(filePath);

    // Admin pages are bound to descriptors by
    // `tests/admin-navigation-registry.test.ts`; a second claim here would be a
    // second source of truth for the same fact.
    if (route === "/admin" || route.startsWith("/admin/")) {
      continue;
    }

    scanned++;

    if (platform.has(route)) {
      continue;
    }

    if (!resolveOwner(route, claims)) {
      unowned++;
      problems.push(
        `${filePath} (${route}) — no module claims this route. Add its prefix to ` +
          "the owning module's `api.routes`, or add a PLATFORM_ROUTES entry with a reason."
      );
    }
  }

  if (scanned === 0) {
    console.error(
      `modules:routes:check GAGAL — 0 berkas dipindai di ${PAGES_ROOT}. Jalankan dari root repository.`
    );
    process.exit(1);
  }

  // A platform exemption for a route that no longer exists makes the list look
  // considered while excusing nothing.
  const allRoutes = new Set<string>();

  for await (const file of walk(PAGES_ROOT)) {
    allRoutes.add(routeOf(file.split(path.sep).join("/")));
  }

  for (const entry of PLATFORM_ROUTES) {
    if (!allRoutes.has(entry.route)) {
      problems.push(
        `${entry.route} is in PLATFORM_ROUTES but no such route exists — remove it.`
      );
    }
  }

  if (problems.length === 0) {
    console.log(
      `modules:routes:check OK — ${scanned} rute non-admin dipetakan ke ${claims.length} ` +
        `prefix milik modul, plus ${PLATFORM_ROUTES.length} rute platform beralasan. ` +
        "Nol rute tak-terklaim, nol prefix diklaim ganda."
    );
    process.exit(0);
  }

  for (const problem of problems) {
    console.error(problem);
  }

  console.error(
    `\nmodules:routes:check GAGAL — ${problems.length} temuan (${unowned} rute tak-terklaim).`
  );
  process.exit(1);
}

if (import.meta.main) {
  await main();
}
