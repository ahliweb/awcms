/**
 * ADR-0107 — the public search endpoints answer a reader's browser on another
 * origin, and the tenant a cross-origin request gets is the one that owns the
 * ORIGIN.
 *
 * Two layers, split the same way `tests/analytics-beacon-cors.test.ts` splits
 * them:
 *
 *   1. here — the pure header policy and the classification of an `Origin`,
 *      with the allow-list lookup driven by a fake so every BRANCH can be
 *      reached cheaply;
 *   2. `tests/integration/site-search-cors.integration.test.ts` — the part a
 *      fake cannot be trusted with: that the allow-list really is
 *      `awcms_tenant_domains`, and that a cross-origin request never falls
 *      through to the deployment's default tenant.
 *
 * The second file is where the load-bearing assertion lives, because the defect
 * this design exists to prevent (tenant A's site being served the DEFAULT
 * tenant's articles) is invisible to a mock that was told what to return.
 */
import { describe, expect, test } from "bun:test";

import { publicSearchCorsHeaders } from "../src/modules/site-search/domain/search-cors";
import { resolvePublicSearchOrigin } from "../src/modules/site-search/application/public-search-tenant-resolution";

const ENDPOINT = "https://cms.example/api/v1/site-search/query";

function requestWithOrigin(origin: string | null): Request {
  return new Request(ENDPOINT, {
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

describe("publicSearchCorsHeaders", () => {
  test("a grant echoes the origin verbatim and never `*`", () => {
    const headers = publicSearchCorsHeaders({
      kind: "granted",
      origin: "https://news.example"
    });

    expect(headers["access-control-allow-origin"]).toBe("https://news.example");
    expect(headers["access-control-allow-origin"]).not.toBe("*");
    expect(headers.vary).toBe("Origin");
  });

  test("a grant carries NO credentials header", () => {
    // Deliberate: search needs no cookie, and a response without
    // `Allow-Credentials` cannot be read by a credentialed request at all. That
    // is what keeps this surface from ever becoming a confused-deputy path to
    // something a reader's cookies would unlock.
    const headers = publicSearchCorsHeaders({
      kind: "granted",
      origin: "https://news.example"
    });

    expect(headers["access-control-allow-credentials"]).toBeUndefined();
  });

  test("a refusal is the ABSENCE of the grant, and still says Vary", () => {
    const headers = publicSearchCorsHeaders({ kind: "refused" });

    expect(headers["access-control-allow-origin"]).toBeUndefined();
    // A cached refusal handed to an allowed origin is the same defect as a
    // cached grant handed to a refused one.
    expect(headers.vary).toBe("Origin");
  });

  test("a same-origin answer says Vary too", () => {
    expect(publicSearchCorsHeaders({ kind: "same_origin" }).vary).toBe(
      "Origin"
    );
  });
});

describe("resolvePublicSearchOrigin", () => {
  test("no Origin header at all is same-origin, and costs no lookup", async () => {
    let queried = false;
    const sql = (() => {
      queried = true;
      return Promise.resolve([]);
    }) as unknown as Bun.SQL;

    const resolved = await resolvePublicSearchOrigin(
      sql,
      requestWithOrigin(null)
    );

    expect(resolved.decision.kind).toBe("same_origin");
    expect(resolved.tenant).toBeNull();
    // The cost of the cross-origin surface must land only on the cross-origin
    // surface: this repo's own `/search` page must not pay a query for it.
    expect(queried).toBe(false);
  });

  test("our own origin is same-origin", async () => {
    const resolved = await resolvePublicSearchOrigin(
      sqlReturning([ACTIVE_DOMAIN_ROW]),
      requestWithOrigin("https://cms.example")
    );

    expect(resolved.decision.kind).toBe("same_origin");
  });

  test("an opaque `null` origin is same-origin, never granted", async () => {
    // A sandboxed iframe and a `file://` document both send this. It must not
    // reach the allow-list at all — `parseRequestOrigin` refuses it first.
    const resolved = await resolvePublicSearchOrigin(
      sqlReturning([ACTIVE_DOMAIN_ROW]),
      requestWithOrigin("null")
    );

    expect(resolved.decision.kind).toBe("same_origin");
  });

  test("a cross-origin caller whose host resolves is granted", async () => {
    const resolved = await resolvePublicSearchOrigin(
      sqlReturning([ACTIVE_DOMAIN_ROW]),
      requestWithOrigin("https://news.example")
    );

    expect(resolved.decision).toEqual({
      kind: "granted",
      origin: "https://news.example"
    });
    expect(resolved.tenant?.tenantId).toBe(ACTIVE_DOMAIN_ROW.tenant_id);
  });

  test("a cross-origin caller whose host does not resolve is refused, with NO tenant", async () => {
    const resolved = await resolvePublicSearchOrigin(
      sqlReturning([]),
      requestWithOrigin("https://nobody.example")
    );

    expect(resolved.decision.kind).toBe("refused");
    // The whole point: `refused` never carries a tenant, so there is nothing
    // for a later branch to accidentally serve.
    expect(resolved.tenant).toBeNull();
  });

  test("a domain that is not `active` is refused even though the row exists", async () => {
    const resolved = await resolvePublicSearchOrigin(
      sqlReturning([
        { ...ACTIVE_DOMAIN_ROW, domain_status: "pending_verification" }
      ]),
      requestWithOrigin("https://news.example")
    );

    expect(resolved.decision.kind).toBe("refused");
  });

  test("a suspended TENANT is refused even though its domain is active", async () => {
    const resolved = await resolvePublicSearchOrigin(
      sqlReturning([{ ...ACTIVE_DOMAIN_ROW, tenant_status: "suspended" }]),
      requestWithOrigin("https://news.example")
    );

    expect(resolved.decision.kind).toBe("refused");
  });

  test("a non-http(s) origin never reaches the allow-list", async () => {
    for (const origin of [
      "chrome-extension://abcdefghijklmnop",
      "moz-extension://abcdefghijklmnop"
    ]) {
      const resolved = await resolvePublicSearchOrigin(
        sqlReturning([ACTIVE_DOMAIN_ROW]),
        requestWithOrigin(origin)
      );

      expect(resolved.decision.kind).toBe("same_origin");
    }
  });
});
