/**
 * Every API endpoint that accepts a body refuses an invalid credential BEFORE
 * reading it — checked against a running server, endpoint by endpoint.
 *
 * ## Why this has to run rather than read
 *
 * The defect it guards was invisible to every static gate in this repo, and
 * `bun run check` passed on the day it was measured. `defineTenantRoute`
 * checked that a token was PRESENT, then ran the route's body validation. So:
 *
 *     POST /api/v1/blog/institutions   Authorization: Bearer nonsense
 *     → 400 VALIDATION_ERROR + every field name, enum value and length limit
 *
 * **77 session-gated endpoints answered that way**, and none of those requests
 * reached `authorizeInTransaction` — which is what writes the decision log — so
 * an attacker enumerating the API left no trace at all.
 *
 * A source gate cannot see this. Ordering between a `prepare` hook and a
 * chokepoint call is not a text property: the leaking routes were spread across
 * a shared factory (14) and hand-written handlers (63), and a textual
 * "validation appears before authorization" scan reported 297 of 305 route
 * blocks — a number so wrong it was useless. What settles it is asking the
 * server.
 *
 * ## What it asserts
 *
 * For every `POST`/`PUT`/`PATCH`/`DELETE` route discovered under
 * `src/pages/api`, sent with a syntactically valid tenant header and a
 * deliberately bogus bearer token:
 *
 * - an endpoint declared in `SESSION_FREE_BODY_ENDPOINTS` may answer however it
 *   likes — it is public by design, and the list states why for each one;
 * - **every other endpoint must answer `401`** and must not disclose a
 *   validation detail.
 *
 * The exemption list is imported from the same module the middleware uses, so
 * this cannot drift from the boundary it is checking. A new public endpoint
 * fails here until it is declared, with a reason, in that list.
 *
 * ## Wave
 *
 * WRITE wave. Nothing here mutates — every request is refused by construction —
 * but the requests are non-GET, and classifying by what a spec ATTEMPTS rather
 * than by what it happens to achieve is the rule that stays true when a defect
 * makes the attempt succeed. That is exactly the case this spec exists to
 * catch.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { test, expect } from "@playwright/test";

import {
  SESSION_FREE_BODY_ENDPOINTS,
  isSessionFreeBodyEndpoint
} from "../../src/lib/security/api-body-auth-boundary";

const tenantId = process.env.E2E_TENANT_ID;

const HERE = path.dirname(new URL(import.meta.url).pathname);
const API_ROOT = path.resolve(HERE, "../../src/pages/api");

/**
 * A stand-in for any `[param]` segment. It is a well-formed UUID so a route
 * that validates the SHAPE of its id cannot answer `400` for that reason and
 * be mistaken for a leak.
 */
const DUMMY_ID = "00000000-0000-4000-8000-000000000000";

const BOGUS_TOKEN = "Bearer e2e-not-a-real-token-0000000000";

type BodyRoute = {
  method: string;
  url: string;
  pattern: string;
  source: string;
};

function discoverBodyRoutes(dir: string, prefix = "/api"): BodyRoute[] {
  const routes: BodyRoute[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      routes.push(...discoverBodyRoutes(full, `${prefix}/${entry.name}`));
      continue;
    }

    if (!entry.name.endsWith(".ts")) continue;

    const base = entry.name.slice(0, -".ts".length);
    const pattern = base === "index" ? prefix : `${prefix}/${base}`;
    const source = readFileSync(full, "utf8");

    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      if (!new RegExp(`export const ${method}\\b`).test(source)) continue;
      routes.push({
        method,
        pattern,
        url: pattern.replace(/\[[^\]]+\]/g, DUMMY_ID),
        source: path.relative(process.cwd(), full)
      });
    }
  }

  return routes.sort((a, b) =>
    `${a.pattern}${a.method}`.localeCompare(`${b.pattern}${b.method}`)
  );
}

const bodyRoutes = discoverBodyRoutes(API_ROOT);

// This spec must present exactly one credential — the bogus one. Inheriting the
// shared owner session would authenticate every request and turn the whole file
// into a test that proves nothing while passing.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("API endpoints refuse an invalid credential before reading a body", () => {
  test.skip(
    !tenantId,
    "requires a seeded tenant — CI e2e-smoke provisions one via POST /api/v1/setup/initialize"
  );

  test("the route walk found the API surface", () => {
    // A walk that stops matching would make every assertion below pass by
    // having nothing to check — a gate reporting success having examined
    // nothing, which is the shape this repo keeps finding.
    expect(
      bodyRoutes.length,
      "no body-accepting API routes were discovered under src/pages/api"
    ).toBeGreaterThan(200);
  });

  test("a bogus bearer token is refused, and discloses nothing", async ({
    request
  }) => {
    test.setTimeout(240_000);

    let checked = 0;

    for (const route of bodyRoutes) {
      if (isSessionFreeBodyEndpoint(route.method, route.url)) continue;
      checked++;

      const response = await request.fetch(route.url, {
        method: route.method,
        headers: {
          "x-awcms-tenant-id": tenantId!,
          authorization: BOGUS_TOKEN,
          "content-type": "application/json"
        },
        data: "{}",
        failOnStatusCode: false
      });

      const status = response.status();
      const body = await response.text();

      expect
        .soft(
          status,
          `${route.method} ${route.pattern} (${route.source}) answered ${status} ` +
            "to a bogus bearer token, expected 401. If this endpoint is meant " +
            "to be reachable without a session, declare it in " +
            "SESSION_FREE_BODY_ENDPOINTS with a reason — do not relax this " +
            "assertion. A 400 here means the body was validated before the " +
            "caller was authenticated, which is how 77 endpoints handed out " +
            "their schema and left no decision-log row."
        )
        .toBe(401);

      expect
        .soft(
          /VALIDATION_ERROR|"field"/.test(body),
          `${route.method} ${route.pattern} (${route.source}) disclosed ` +
            "validation detail to an unauthenticated caller."
        )
        .toBe(false);
    }

    // The loop is only meaningful if it had work to do. If the exemption list
    // ever grew to cover everything, every assertion above would be skipped and
    // this file would report success having tested nothing.
    expect(
      checked,
      "no protected endpoints were checked — the exemption list now covers the whole API"
    ).toBeGreaterThan(150);
  });

  test("every declared exemption still exists as a route", () => {
    // The mirror of the pure test's version of this: there, it is checked
    // against the filesystem; here, the same list is confirmed against the
    // routes this run actually discovered, so a walk that silently narrows is
    // caught from the other side too.
    const discovered = new Set(
      bodyRoutes.map((route) => `${route.method} ${route.pattern}`)
    );

    for (const endpoint of SESSION_FREE_BODY_ENDPOINTS) {
      const asFilePattern = endpoint.pattern
        .split("/")
        .map((part) => (part.startsWith(":") ? `[${part.slice(1)}]` : part))
        .join("/");

      const matched = [...discovered].some((key) => {
        const [method, pattern] = key.split(" ");
        if (method !== endpoint.method) return false;
        return (
          pattern!.split("/").map(segmentKey).join("/") ===
          asFilePattern.split("/").map(segmentKey).join("/")
        );
      });

      expect(
        matched,
        `${endpoint.method} ${endpoint.pattern} is exempt from the ` +
          "authentication boundary but was not discovered as a route."
      ).toBe(true);
    }
  });
});

/** `[id]` and `[providerKey]` are the same shape as far as a URL is concerned. */
function segmentKey(part: string): string {
  return part.startsWith("[") && part.endsWith("]") ? "*" : part;
}
