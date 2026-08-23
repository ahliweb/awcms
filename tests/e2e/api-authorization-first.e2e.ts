/**
 * A tenant user holding NO permissions is refused by the authorization
 * chokepoint — not by a validator that runs before it and records nothing.
 *
 * ## What this is really measuring
 *
 * ADR-0063 made `authorizeInTransaction` the one place an access decision is
 * taken, and it is also the one place a decision is WRITTEN DOWN. A route that
 * refuses before reaching it refuses invisibly: no decision-log row, nothing an
 * audit can read. So "which endpoints answer something other than 403" is the
 * same question as "which refusals leave no trace".
 *
 * The companion spec `api-body-auth-boundary.e2e.ts` covers the caller who is
 * nobody. This one covers the caller who is somebody with no grant — a shape
 * every tenant has, and the one a static gate is least able to reason about.
 *
 * ## The ledger, and both directions of it
 *
 * `support/authorization-first-ledger.ts` lists what is known to answer early.
 * This fails when an unlisted endpoint answers anything but `403` — the debt
 * growing — and equally when a LISTED endpoint answers `403`, which means it
 * was fixed and its row must be deleted. Without that second direction the
 * ledger fills with stale rows and stops meaning anything.
 *
 * ## Two traps this spec had to be built around
 *
 * **It logged itself out.** Sweeping every route with a live session hit
 * `POST /api/v1/auth/logout`, and every request after that answered `401` — a
 * self-inflicted false negative that looked exactly like a passing gate for the
 * boundary spec next door. Session-destroying endpoints are skipped, by name.
 *
 * **Self-service routes owe this user a real answer.** `defineSelfServiceTenantRoute`
 * has no permission to check — the subject IS the caller — so
 * `POST /api/v1/auth/preferences` answering `200` here is the product working,
 * not a hole. They are identified by the helper their source calls, so the
 * exemption cannot outlive its reason.
 *
 * ## Wave
 *
 * WRITE wave, for the same reason as the boundary spec: it sends non-GET
 * requests. Nothing is expected to succeed, but classifying by what a spec
 * ATTEMPTS is the rule that stays true when a defect makes the attempt succeed.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { test, expect } from "@playwright/test";

import { isSessionFreeBodyEndpoint } from "../../src/lib/security/api-body-auth-boundary";
import { provideTenant } from "./support/e2e-auth";
import { seedRestrictedUser } from "./support/e2e-restricted-user";
import {
  AUTHORIZATION_FIRST_DEBT,
  isKnownAuthorizationFirstDebt
} from "./support/authorization-first-ledger";

const tenantId = process.env.E2E_TENANT_ID;
const databaseUrl = process.env.DATABASE_URL;

const seeded = Boolean(tenantId && databaseUrl);

const HERE = path.dirname(new URL(import.meta.url).pathname);
const API_ROOT = path.resolve(HERE, "../../src/pages/api");

const DUMMY_ID = "00000000-0000-4000-8000-000000000000";

/**
 * Absolute URLs throughout. The `request` fixture resolved a relative path for
 * the first call and then threw `cannot be parsed as a URL` on the next, so the
 * base is applied here rather than relied on.
 */
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:4321";
const at = (pathname: string): string => `${BASE_URL}${pathname}`;

/**
 * Endpoints that would end THIS spec's own session. Sweeping every route with a
 * live cookie logged the sweep out, and every later result became a `401` that
 * reads exactly like success.
 */
const SESSION_DESTROYING =
  /\/auth\/(logout|sessions|session\/switch|session-handoff)/;

type Probe = { method: string; url: string; endpoint: string; source: string };

function discoverProbes(dir: string, prefix = "/api"): Probe[] {
  const probes: Probe[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      probes.push(...discoverProbes(full, `${prefix}/${entry.name}`));
      continue;
    }

    if (!entry.name.endsWith(".ts")) continue;

    const source = readFileSync(full, "utf8");

    // Self-service has no permission to check — see the header.
    if (source.includes("defineSelfServiceTenantRoute")) continue;

    const base = entry.name.slice(0, -".ts".length);
    const pattern = base === "index" ? prefix : `${prefix}/${base}`;

    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      if (!new RegExp(`export const ${method}\\b`).test(source)) continue;

      const url = pattern.replace(/\[[^\]]+\]/g, DUMMY_ID);
      if (SESSION_DESTROYING.test(url)) continue;
      if (isSessionFreeBodyEndpoint(method, url)) continue;

      probes.push({
        method,
        url,
        endpoint: `${method} ${pattern.replace(/\[([^\]]+)\]/g, ":$1")}`,
        source: path.relative(process.cwd(), full)
      });
    }
  }

  return probes.sort((a, b) => a.endpoint.localeCompare(b.endpoint));
}

const probes = discoverProbes(API_ROOT);

// Authenticates as somebody other than the shared owner.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("authorization answers before anything else", () => {
  test.skip(
    !seeded,
    "requires a seeded tenant and DATABASE_URL — CI e2e-smoke provides both"
  );

  test("the route walk found the gated surface", () => {
    expect(
      probes.length,
      "no gated body-accepting API routes were discovered"
    ).toBeGreaterThan(150);
  });

  test("a zero-permission session gets 403, or is a known ledger entry", async ({
    page
  }) => {
    test.setTimeout(300_000);

    const user = await seedRestrictedUser(databaseUrl!, tenantId!, "none");

    /**
     * Signed in through the real form, then the browser context's own
     * `page.request` reuses those cookies for the sweep.
     *
     * The direct API route was tried first — `POST /api/v1/auth/login` followed
     * by `/api/v1/auth/session/tenant` (ADR-0087's two steps) — and the
     * standalone `request` fixture threw `cannot be parsed as a URL` on the
     * second call even with an absolute URL. Rather than keep guessing at a
     * fixture's URL handling, this uses the path every other spec here already
     * proves works, and gets the multi-step sign-in for free.
     */
    await page.goto("/login");
    await provideTenant(page, tenantId!);
    await page.locator("#login-identifier").fill(user.loginIdentifier);
    await page.locator("#password").fill(user.password);
    await page.locator("#login-submit").click();
    await page.waitForURL("**/admin");

    const request = page.request;

    // Prove the session is live before drawing conclusions from refusals. A
    // logged-out sweep answers 401 everywhere, which would read as this gate
    // finding nothing wrong.
    const liveness = await request.post(at("/api/v1/blog/institutions"), {
      headers: { "x-awcms-tenant-id": tenantId! },
      data: {},
      failOnStatusCode: false
    });
    expect(
      liveness.status(),
      "the seeded zero-permission session is not usable — every result below " +
        "would be a 401 that looks like success"
    ).toBe(403);

    const fixed: string[] = [];

    for (const probe of probes) {
      const response = await request.fetch(at(probe.url), {
        method: probe.method,
        headers: { "x-awcms-tenant-id": tenantId! },
        data: "{}",
        failOnStatusCode: false
      });

      const status = response.status();
      const code =
        /"code":"([A-Z_]+)"/.exec(await response.text())?.[1] ?? "NO_CODE";

      if (isKnownAuthorizationFirstDebt(probe.endpoint)) {
        // The shrink direction: a ledger entry that now answers 403 has been
        // fixed, and leaving it listed would let the next real regression hide
        // behind a row nobody re-checked.
        if (status === 403) fixed.push(probe.endpoint);
        continue;
      }

      expect
        .soft(
          status,
          `${probe.endpoint} (${probe.source}) answered ${status} ${code} to a session ` +
            "holding ZERO permissions, expected 403. Something ran before " +
            "`authorizeInTransaction`, so the refusal left no decision-log row " +
            "— ADR-0063 made that the one place a decision is recorded. Fix it " +
            "by HOLDING the refusal until authorization has answered (see " +
            "media/news-images/upload-sessions for the worked example), or, if " +
            "this is genuinely correct, say why in " +
            "support/authorization-first-ledger.ts."
        )
        .toBe(403);
    }

    expect(
      fixed,
      "these endpoints now answer 403 and must be DELETED from " +
        "AUTHORIZATION_FIRST_DEBT — a ledger that keeps rows it no longer " +
        "needs is one nobody reads."
    ).toEqual([]);
  });

  test("every ledger entry still names a route that exists", () => {
    const discovered = new Set(probes.map((probe) => probe.endpoint));

    for (const debt of AUTHORIZATION_FIRST_DEBT) {
      expect(
        discovered.has(debt.endpoint),
        `${debt.endpoint} is on the authorization-first ledger but was not ` +
          "discovered as a gated route. Either it moved, or it is gone — and " +
          "a debt entry for a route that does not exist quietly pre-approves " +
          "whatever is built there next."
      ).toBe(true);
    }
  });
});
