import { describe, expect, test } from "bun:test";

import { buildPublicHostResolverConfigFromEnv } from "../src/modules/seo-distribution/application/public-seo-tenant-resolution";
import {
  finalizeDiscoveryResponse,
  parseDiscoveryLocaleParam
} from "../src/lib/seo/discovery-route";
import {
  resolvePublicTenantFromRequest,
  type PublicHostResolverDeps,
  type PublicTenantResolution
} from "../src/lib/tenant/public-host-tenant-resolver";
import type { DiscoveryPayload } from "../src/modules/seo-distribution/application/seo-discovery-service";

const HOST_TENANT: PublicTenantResolution = {
  tenantId: "host-tenant",
  tenantCode: "host",
  tenantName: "Host Tenant",
  defaultLocale: "en"
};
const ENV_TENANT: PublicTenantResolution = {
  tenantId: "env-tenant",
  tenantCode: "env",
  tenantName: "Env Tenant",
  defaultLocale: "en"
};

function deps(
  overrides: Partial<PublicHostResolverDeps> = {}
): PublicHostResolverDeps {
  return {
    resolvePublicTenantByHost: async () => HOST_TENANT,
    resolveDefaultPublicTenantFromEnv: async () => ENV_TENANT,
    resolveDefaultPublicTenantFromSetupState: async () => null,
    ...overrides
  };
}

const sql = {} as Bun.SQL;

describe("buildPublicHostResolverConfigFromEnv", () => {
  test("maps PUBLIC_TENANT_RESOLUTION_MODE + PUBLIC_TRUST_PROXY", () => {
    expect(
      buildPublicHostResolverConfigFromEnv({
        PUBLIC_TENANT_RESOLUTION_MODE: "host_default",
        PUBLIC_TRUST_PROXY: "true"
      } as NodeJS.ProcessEnv)
    ).toEqual({ mode: "host_default", trustProxy: true });
  });

  test("trustProxy defaults false unless the env value is exactly 'true'", () => {
    expect(
      buildPublicHostResolverConfigFromEnv({
        PUBLIC_TRUST_PROXY: "1"
      } as NodeJS.ProcessEnv).trustProxy
    ).toBe(false);
    expect(
      buildPublicHostResolverConfigFromEnv({} as NodeJS.ProcessEnv).trustProxy
    ).toBe(false);
  });
});

describe("host gating (resolvePublicTenantFromRequest, the resolver seo relies on)", () => {
  test("host_default mode resolves via the host lookup", async () => {
    const result = await resolvePublicTenantFromRequest(
      sql,
      "example.com",
      { mode: "host_default" },
      deps()
    );
    expect(result).toEqual(HOST_TENANT);
  });

  test("host lookup is NOT attempted unless mode is host_default (falls to env)", async () => {
    let hostCalled = false;
    const result = await resolvePublicTenantFromRequest(
      sql,
      "example.com",
      {}, // undefined mode
      deps({
        resolvePublicTenantByHost: async () => {
          hostCalled = true;
          return HOST_TENANT;
        }
      })
    );
    expect(hostCalled).toBe(false);
    expect(result).toEqual(ENV_TENANT);
  });

  test("tenant_code_legacy short-circuits to null (no default-tenant guess)", async () => {
    let anyCalled = false;
    const mark = async () => {
      anyCalled = true;
      return ENV_TENANT;
    };
    const result = await resolvePublicTenantFromRequest(
      sql,
      "example.com",
      { mode: "tenant_code_legacy" },
      deps({
        resolvePublicTenantByHost: mark,
        resolveDefaultPublicTenantFromEnv: mark,
        resolveDefaultPublicTenantFromSetupState: mark
      })
    );
    expect(result).toBeNull();
    expect(anyCalled).toBe(false);
  });

  test("host_default with an unresolvable host falls back to env", async () => {
    const result = await resolvePublicTenantFromRequest(
      sql,
      "example.com",
      { mode: "host_default" },
      deps({ resolvePublicTenantByHost: async () => null })
    );
    expect(result).toEqual(ENV_TENANT);
  });
});

describe("parseDiscoveryLocaleParam", () => {
  test("accepts a BCP-47-ish tag, rejects junk", () => {
    expect(parseDiscoveryLocaleParam("en")).toBe("en");
    expect(parseDiscoveryLocaleParam("en-US")).toBe("en-US");
    expect(parseDiscoveryLocaleParam(null)).toBeNull();
    expect(parseDiscoveryLocaleParam("")).toBeNull();
    expect(parseDiscoveryLocaleParam("'; DROP TABLE")).toBeNull();
    expect(parseDiscoveryLocaleParam("x".repeat(40))).toBeNull();
  });
});

describe("finalizeDiscoveryResponse", () => {
  const payload: DiscoveryPayload = {
    body: "BODY",
    contentType: "application/xml; charset=utf-8",
    etag: '"abc123"',
    lastModified: new Date("2026-07-01T00:00:00.000Z")
  };

  test("200 with body + validators when the client has no matching copy", async () => {
    const res = finalizeDiscoveryResponse(
      new Request("http://x.test/sitemap.xml"),
      payload
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).toBe('"abc123"');
    expect(res.headers.get("cache-control")).toContain(
      "stale-while-revalidate"
    );
    expect(await res.text()).toBe("BODY");
  });

  test("304 with no body when If-None-Match matches", async () => {
    const res = finalizeDiscoveryResponse(
      new Request("http://x.test/sitemap.xml", {
        headers: { "if-none-match": '"abc123"' }
      }),
      payload
    );
    expect(res.status).toBe(304);
    expect(await res.text()).toBe("");
    // 304 still carries the validators.
    expect(res.headers.get("etag")).toBe('"abc123"');
  });
});
