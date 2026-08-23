/**
 * The exemption list for the API body-authentication boundary is real, reasoned,
 * and cannot be widened by accident.
 *
 * ## What the boundary is defending
 *
 * `src/lib/security/api-body-auth-boundary.ts` has the full story. In short: 77
 * session-gated endpoints answered `Authorization: Bearer nonsense` with their
 * complete validation schema and wrote nothing to the decision log, because
 * body validation ran before authentication. The boundary refuses those
 * requests in middleware.
 *
 * A boundary with an allow-list is only as good as the allow-list, and this is
 * the half of it that can be checked without a server. The other half —
 * whether anything OUTSIDE the list still answers an invalid token — is a
 * runtime property and lives in `tests/e2e/api-body-auth-boundary.e2e.ts`,
 * because no amount of reading proves it.
 *
 * Pure: no database, no network. Runs in `quality` on every PR.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import {
  SESSION_FREE_BODY_ENDPOINTS,
  isSessionFreeBodyEndpoint,
  matchesEndpointPattern,
  requiresAuthenticatedCallerBeforeBody
} from "../src/lib/security/api-body-auth-boundary";

const API_ROOT = path.resolve(import.meta.dir, "../src/pages/api");

/** `:id` and `[providerKey]` both become `*`, so the two spellings compare. */
function normalise(pattern: string): string {
  return pattern
    .split("/")
    .map((part) =>
      part.startsWith(":") || (part.startsWith("[") && part.endsWith("]"))
        ? "*"
        : part
    )
    .join("/");
}

/** Every method+URL the pages directory actually serves under `/api`. */
function routesOnDisk(): { method: string; pattern: string }[] {
  const found: { method: string; pattern: string }[] = [];

  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(full, `${prefix}/${entry.name}`);
        continue;
      }

      if (!entry.name.endsWith(".ts")) continue;

      const base = entry.name.slice(0, -".ts".length);
      const url = base === "index" ? prefix : `${prefix}/${base}`;
      const source = readFileSync(full, "utf8");

      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        if (new RegExp(`export const ${method}\\b`).test(source)) {
          found.push({ method, pattern: url });
        }
      }
    }
  };

  walk(API_ROOT, "/api");
  return found;
}

describe("API body-authentication boundary", () => {
  test("the boundary applies to bodies, not to reads", () => {
    // A GET carries no body, and its query string is something the caller
    // already knows. Exempting reads is what keeps one session lookup off the
    // path an admin UI takes most often.
    expect(
      requiresAuthenticatedCallerBeforeBody("GET", "/api/v1/blog/posts")
    ).toBe(false);
    expect(
      requiresAuthenticatedCallerBeforeBody("HEAD", "/api/v1/blog/posts")
    ).toBe(false);
    expect(
      requiresAuthenticatedCallerBeforeBody("POST", "/api/v1/blog/posts")
    ).toBe(true);
    expect(
      requiresAuthenticatedCallerBeforeBody("DELETE", "/api/v1/blog/posts/abc")
    ).toBe(true);
  });

  test("it applies to /api only", () => {
    expect(requiresAuthenticatedCallerBeforeBody("POST", "/login")).toBe(false);
    expect(
      requiresAuthenticatedCallerBeforeBody("POST", "/admin/offices")
    ).toBe(false);
  });

  test("a declared endpoint is exempt, and only for its own method", () => {
    expect(
      requiresAuthenticatedCallerBeforeBody("POST", "/api/v1/auth/login")
    ).toBe(false);

    // `PUT /api/v1/auth/login` is not a thing, and if it ever becomes one it
    // must be decided on rather than inheriting POST's exemption.
    expect(
      requiresAuthenticatedCallerBeforeBody("PUT", "/api/v1/auth/login")
    ).toBe(true);
  });

  test("a trailing slash does not slip past the list", () => {
    // The bypass this closes: `/api/v1/blog/institutions/` is the same endpoint
    // as `/api/v1/blog/institutions`, and an allow-list that treats them as two
    // strings exempts the second by accident. Both directions are checked —
    // a declared endpoint stays declared, and a protected one stays protected.
    expect(
      requiresAuthenticatedCallerBeforeBody("POST", "/api/v1/auth/login/")
    ).toBe(false);
    expect(
      requiresAuthenticatedCallerBeforeBody(
        "POST",
        "/api/v1/blog/institutions/"
      )
    ).toBe(true);
  });

  test("a path parameter matches exactly one segment", () => {
    expect(
      matchesEndpointPattern(
        "/api/v1/comments/:id/replies",
        "/api/v1/comments/abc/replies"
      )
    ).toBe(true);

    // Not two segments — otherwise `/comments/a/b/replies` would inherit the
    // exemption of a route that does not serve it.
    expect(
      matchesEndpointPattern(
        "/api/v1/comments/:id/replies",
        "/api/v1/comments/a/b/replies"
      )
    ).toBe(false);

    // Not zero segments either.
    expect(
      matchesEndpointPattern(
        "/api/v1/comments/:id/replies",
        "/api/v1/comments//replies"
      )
    ).toBe(false);
  });

  test("the method comparison is case-insensitive on the caller's side", () => {
    expect(isSessionFreeBodyEndpoint("post", "/api/v1/auth/login")).toBe(true);
  });

  test("every exemption carries a reason", () => {
    for (const endpoint of SESSION_FREE_BODY_ENDPOINTS) {
      // The reason is the entry's justification, and a blank one turns the list
      // from a set of decisions into a set of holes.
      expect(
        endpoint.reason.trim().length,
        `${endpoint.method} ${endpoint.pattern} is exempt from authentication with no stated reason.`
      ).toBeGreaterThan(20);
    }
  });

  test("every exemption names a route that exists", () => {
    const onDisk = new Set(
      routesOnDisk().map(
        (route) => `${route.method} ${normalise(route.pattern)}`
      )
    );

    for (const endpoint of SESSION_FREE_BODY_ENDPOINTS) {
      const key = `${endpoint.method} ${normalise(endpoint.pattern)}`;

      // A stale exemption is worse than a missing one: it silently pre-approves
      // whatever later takes that path. This is what makes deleting a public
      // endpoint also delete its exemption.
      expect(
        onDisk.has(key),
        `${key} is exempt from the authentication boundary, but no route file ` +
          "exports that method at that path. Either the route moved and the " +
          "exemption did not, or the exemption outlived the endpoint — and an " +
          "exemption with no route pre-approves whatever is built there next."
      ).toBe(true);
    }
  });

  test("no duplicate exemptions", () => {
    const keys = SESSION_FREE_BODY_ENDPOINTS.map(
      (endpoint) => `${endpoint.method} ${endpoint.pattern}`
    );

    expect(new Set(keys).size, "an endpoint is exempt twice").toBe(keys.length);
  });

  test("the exemption list is a small, reviewed minority", () => {
    const bodyRoutes = routesOnDisk().length;

    // Not a style rule. This list is the entire attack surface the boundary
    // does not cover, so it existing as a handful rather than a habit is the
    // property worth asserting. If a change makes this fail, the question is
    // not "raise the number" — it is which endpoint stopped needing a session.
    expect(SESSION_FREE_BODY_ENDPOINTS.length).toBeLessThan(bodyRoutes / 4);
  });
});
