/**
 * ADR-0118 — the newsletter endpoints answer a reader's browser on another
 * origin, and a cross-origin request's tenant is the one that owns the ORIGIN.
 *
 * Split the same way `tests/site-search-cors.test.ts` and
 * `tests/analytics-beacon-cors.test.ts` split their subject:
 *
 *   1. here — the pure header policy, the classification of an `Origin`, and
 *      the preflight, with the allow-list lookup driven by a fake so every
 *      BRANCH is reachable cheaply;
 *   2. the integration suite — the part a fake cannot be trusted with: that the
 *      allow-list really is `awcms_tenant_domains`, and that a cross-origin
 *      subscription never falls through to the deployment's default tenant.
 *
 * The defect this design exists to prevent is a WRONG SUCCESS — a stranger's
 * address written into somebody else's list, with a 200 in front of it — so the
 * assertions below are mostly about what does NOT happen.
 */
import { describe, expect, test } from "bun:test";

import { newsletterPreflightResponse } from "../src/modules/newsletter/application/public-newsletter-preflight";
import { resolvePublicNewsletterOrigin } from "../src/modules/newsletter/application/public-newsletter-tenant";
import {
  NEWSLETTER_PREFLIGHT_MAX_AGE_SECONDS,
  newsletterCorsHeaders,
  newsletterPreflightHeaders
} from "../src/modules/newsletter/domain/newsletter-cors";

const ENDPOINT = "https://cms.example/api/v1/newsletter/subscribe";

function requestWithOrigin(origin: string | null): Request {
  return new Request(ENDPOINT, {
    method: "POST",
    headers: origin === null ? {} : { origin }
  });
}

/** A `Bun.SQL` stand-in whose single query answers the tenant-domain lookup. */
function sqlReturning(rows: unknown[]): Bun.SQL {
  return (() => Promise.resolve(rows)) as unknown as Bun.SQL;
}

const ACTIVE_DOMAIN_ROW = {
  tenant_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  domain_status: "active",
  is_primary: true,
  route_mode: "domain",
  tenant_status: "active",
  tenant_code: "news-a",
  tenant_name: "News A",
  default_locale: "id"
};

describe("newsletterCorsHeaders", () => {
  test("a grant echoes the origin verbatim and never `*`", () => {
    const headers = newsletterCorsHeaders({
      kind: "granted",
      origin: "https://news.example"
    });

    expect(headers["access-control-allow-origin"]).toBe("https://news.example");
    expect(headers["access-control-allow-origin"]).not.toBe("*");
    expect(headers.vary).toBe("Origin");
  });

  test("a grant carries NO credentials header", () => {
    // The deliberate difference from the beacon, which needs one for its
    // visitor cookie. Nothing here reads or sets a cookie, and a wider grant on
    // an endpoint that SENDS MAIL is bought for nothing.
    const headers = newsletterCorsHeaders({
      kind: "granted",
      origin: "https://news.example"
    });

    expect(headers["access-control-allow-credentials"]).toBeUndefined();
  });

  test("a refusal is the ABSENCE of a grant, and still varies on Origin", () => {
    for (const decision of [
      { kind: "refused" } as const,
      { kind: "same_origin" } as const
    ]) {
      const headers = newsletterCorsHeaders(decision);

      expect(headers["access-control-allow-origin"]).toBeUndefined();
      // A cached denial served to an allowed origin is the same defect as a
      // cached grant served to a denied one.
      expect(headers.vary).toBe("Origin");
    }
  });
});

describe("newsletterPreflightHeaders", () => {
  test("the grant allows `content-type` and nothing else", () => {
    const headers = newsletterPreflightHeaders({
      kind: "granted",
      origin: "https://news.example"
    });

    // `application/json` is the whole point: it is what keeps the request out
    // of Astro's form-like branch, where `checkOrigin` answers 403. Any second
    // allowed header turns this into a general-purpose cross-origin API.
    expect(headers["access-control-allow-headers"]).toBe("content-type");
    expect(headers["access-control-allow-methods"]).toBe("POST, OPTIONS");
    expect(headers["access-control-max-age"]).toBe(
      String(NEWSLETTER_PREFLIGHT_MAX_AGE_SECONDS)
    );
  });

  test("a refusal carries no preflight grant at all", () => {
    const headers = newsletterPreflightHeaders({ kind: "refused" });

    expect(headers["access-control-allow-methods"]).toBeUndefined();
    expect(headers["access-control-allow-headers"]).toBeUndefined();
    expect(headers["access-control-max-age"]).toBeUndefined();
    expect(headers.vary).toBe("Origin");
  });
});

describe("resolvePublicNewsletterOrigin", () => {
  test("no `Origin` header is same-origin, and costs no lookup", async () => {
    let queried = false;
    const sql = (() => {
      queried = true;
      return Promise.resolve([ACTIVE_DOMAIN_ROW]);
    }) as unknown as Bun.SQL;

    const { decision, tenant } = await resolvePublicNewsletterOrigin(
      sql,
      requestWithOrigin(null)
    );

    expect(decision.kind).toBe("same_origin");
    expect(tenant).toBeNull();
    expect(queried).toBe(false);
  });

  test("this endpoint's own origin is same-origin", async () => {
    const { decision } = await resolvePublicNewsletterOrigin(
      sqlReturning([ACTIVE_DOMAIN_ROW]),
      requestWithOrigin("https://cms.example")
    );

    expect(decision.kind).toBe("same_origin");
  });

  test("a cross-origin request whose host owns a tenant is granted THAT tenant", async () => {
    const { decision, tenant } = await resolvePublicNewsletterOrigin(
      sqlReturning([ACTIVE_DOMAIN_ROW]),
      requestWithOrigin("https://news-a.example")
    );

    expect(decision).toEqual({
      kind: "granted",
      origin: "https://news-a.example"
    });
    expect(tenant?.tenantId).toBe(ACTIVE_DOMAIN_ROW.tenant_id);
  });

  test("an unknown origin is REFUSED, never the deployment's default tenant", async () => {
    // The assertion this file exists for. Falling back to the host chain here
    // would resolve the CMS's own tenant — or `PUBLIC_DEFAULT_TENANT_ID` — and
    // a stranger's email address would be written into that list behind a 200
    // nobody could tell apart from a correct one.
    const { decision, tenant } = await resolvePublicNewsletterOrigin(
      sqlReturning([]),
      requestWithOrigin("https://not-ours.example")
    );

    expect(decision.kind).toBe("refused");
    expect(tenant).toBeNull();
  });

  test("a malformed `Origin` is same-origin, not a grant", async () => {
    for (const origin of ["null", "not a url", "://", ""]) {
      const { decision } = await resolvePublicNewsletterOrigin(
        sqlReturning([ACTIVE_DOMAIN_ROW]),
        requestWithOrigin(origin)
      );

      expect(decision.kind).not.toBe("granted");
    }
  });
});

describe("newsletterPreflightResponse", () => {
  const LIMITS = { maxAttempts: 5, windowMs: 300_000 };

  test("a granted preflight answers 204 with the narrow grant", async () => {
    const response = await newsletterPreflightResponse(
      sqlReturning([ACTIVE_DOMAIN_ROW]),
      requestWithOrigin("https://news-a.example"),
      "203.0.113.10",
      "newsletter:test:granted",
      LIMITS
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://news-a.example"
    );
    expect(response.headers.get("access-control-allow-methods")).toBe(
      "POST, OPTIONS"
    );
  });

  test("a refused preflight answers 204 as well — never a status that says no", async () => {
    // A refusal that could be distinguished from a grant by STATUS would tell
    // the caller which origins this deployment serves, which is the oracle the
    // response bodies here already refuse to be.
    const response = await newsletterPreflightResponse(
      sqlReturning([]),
      requestWithOrigin("https://not-ours.example"),
      "203.0.113.11",
      "newsletter:test:refused",
      LIMITS
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("vary")).toBe("Origin");
  });

  test("a same-origin preflight costs neither a lookup nor a limiter slot", async () => {
    let queried = false;
    const sql = (() => {
      queried = true;
      return Promise.resolve([ACTIVE_DOMAIN_ROW]);
    }) as unknown as Bun.SQL;

    const response = await newsletterPreflightResponse(
      sql,
      requestWithOrigin(null),
      "203.0.113.12",
      "newsletter:test:same-origin",
      LIMITS
    );

    expect(response.status).toBe(204);
    expect(queried).toBe(false);
  });

  test("the limiter runs BEFORE the domain lookup", async () => {
    // Order, not just presence. The lookup is a database read on an anonymous
    // request; doing it first would let one address spend this deployment's
    // query budget by sending preflights it never follows up.
    let queries = 0;
    const sql = (() => {
      queries += 1;
      return Promise.resolve([ACTIVE_DOMAIN_ROW]);
    }) as unknown as Bun.SQL;

    const limits = { maxAttempts: 2, windowMs: 300_000 };
    const key = `newsletter:test:order:${Math.random()}`;
    const ip = "203.0.113.13";

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await newsletterPreflightResponse(
        sql,
        requestWithOrigin("https://news-a.example"),
        ip,
        key,
        limits
      );
      statuses.push(response.status);
    }

    expect(statuses.slice(0, 2)).toEqual([204, 204]);
    expect(statuses.slice(2)).toEqual([429, 429]);
    // Two allowed preflights, two lookups. The refused ones never reached the
    // database.
    expect(queries).toBe(2);
  });

  test("a throttled preflight carries `retry-after` and no grant", async () => {
    const limits = { maxAttempts: 1, windowMs: 300_000 };
    const key = `newsletter:test:throttled:${Math.random()}`;
    const ip = "203.0.113.14";
    const sql = sqlReturning([ACTIVE_DOMAIN_ROW]);

    await newsletterPreflightResponse(
      sql,
      requestWithOrigin("https://news-a.example"),
      ip,
      key,
      limits
    );
    const throttled = await newsletterPreflightResponse(
      sql,
      requestWithOrigin("https://news-a.example"),
      ip,
      key,
      limits
    );

    expect(throttled.status).toBe(429);
    expect(throttled.headers.get("retry-after")).not.toBeNull();
    expect(throttled.headers.get("access-control-allow-origin")).toBeNull();
    expect(throttled.headers.get("vary")).toBe("Origin");
  });
});

describe("the three routes are actually reachable", () => {
  const ROUTES = ["subscribe", "confirm", "unsubscribe"] as const;

  test("each one exports OPTIONS as well as POST", async () => {
    // The blocker that hid the other three: with no `OPTIONS`, the preflight a
    // JSON contract forces is never answered and the POST is never sent. A
    // green suite over the POST handler proved nothing about whether a browser
    // could reach it.
    for (const route of ROUTES) {
      const module = await import(`../src/pages/api/v1/newsletter/${route}`);

      expect(typeof module.POST).toBe("function");
      expect(typeof module.OPTIONS).toBe("function");
    }
  });
});
