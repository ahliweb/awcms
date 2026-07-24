import { describe, expect, test } from "bun:test";

import {
  normalizePublicHost,
  resolvePublicTenantFromRequest,
  type PublicHostResolverDeps,
  type PublicTenantResolution
} from "../src/lib/tenant/public-host-tenant-resolver";

const FAKE_SQL = {} as unknown as Bun.SQL;

const HOST_TENANT: PublicTenantResolution = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  tenantCode: "host-tenant",
  tenantName: "Host Tenant",
  defaultLocale: "en"
};
const ENV_TENANT: PublicTenantResolution = {
  tenantId: "22222222-2222-4222-8222-222222222222",
  tenantCode: "env-tenant",
  tenantName: "Env Tenant",
  defaultLocale: "en"
};
const SETUP_TENANT: PublicTenantResolution = {
  tenantId: "33333333-3333-4333-8333-333333333333",
  tenantCode: "setup-tenant",
  tenantName: "Setup Tenant",
  defaultLocale: "en"
};

function makeDeps(
  overrides: Partial<PublicHostResolverDeps> = {}
): PublicHostResolverDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async resolvePublicTenantByHost() {
      calls.push("host");
      return null;
    },
    async resolveDefaultPublicTenantFromEnv() {
      calls.push("env");
      return null;
    },
    async resolveDefaultPublicTenantFromSetupState() {
      calls.push("setup");
      return null;
    },
    ...overrides
  };
}

describe("normalizePublicHost", () => {
  test("lowercases, trims, strips a port", () => {
    expect(normalizePublicHost("  Tenant.Example.COM:4321 ")).toBe(
      "tenant.example.com"
    );
  });

  test("rejects IPv6 literals and underscore/malformed shapes", () => {
    expect(normalizePublicHost("[::1]:4321")).toBeNull();
    expect(normalizePublicHost("_dmarc.example.com")).toBeNull();
    expect(normalizePublicHost("a..b.com")).toBeNull();
  });

  test("throws only on empty input (caller contract violation)", () => {
    expect(() => normalizePublicHost("")).toThrow();
    expect(() => normalizePublicHost("   ")).toThrow();
  });
});

describe("resolvePublicTenantFromRequest resolution order", () => {
  test("host_default resolves via host first, no fallback needed", async () => {
    const deps = makeDeps({
      async resolvePublicTenantByHost() {
        deps.calls.push("host");
        return HOST_TENANT;
      }
    });
    const result = await resolvePublicTenantFromRequest(
      FAKE_SQL,
      "tenant.example.com",
      { mode: "host_default" },
      deps
    );
    expect(result).toEqual(HOST_TENANT);
    expect(deps.calls).toEqual(["host"]);
  });

  test("host miss falls through to env, then setup", async () => {
    const deps = makeDeps({
      async resolveDefaultPublicTenantFromSetupState() {
        deps.calls.push("setup");
        return SETUP_TENANT;
      }
    });
    const result = await resolvePublicTenantFromRequest(
      FAKE_SQL,
      "unmapped.example.com",
      { mode: "host_default" },
      deps
    );
    expect(result).toEqual(SETUP_TENANT);
    expect(deps.calls).toEqual(["host", "env", "setup"]);
  });

  test("non-host mode never calls the host lookup but still runs env fallback", async () => {
    const deps = makeDeps({
      async resolveDefaultPublicTenantFromEnv() {
        deps.calls.push("env");
        return ENV_TENANT;
      }
    });
    const result = await resolvePublicTenantFromRequest(
      FAKE_SQL,
      "tenant.example.com",
      { mode: "env_default" },
      deps
    );
    expect(result).toEqual(ENV_TENANT);
    expect(deps.calls).toEqual(["env"]);
  });

  test("undefined mode (offline/LAN default) still runs the safe fallback chain", async () => {
    const deps = makeDeps({
      async resolveDefaultPublicTenantFromEnv() {
        deps.calls.push("env");
        return ENV_TENANT;
      }
    });
    const result = await resolvePublicTenantFromRequest(
      FAKE_SQL,
      "tenant.example.com",
      {},
      deps
    );
    expect(result).toEqual(ENV_TENANT);
    // No host lookup for an unset mode.
    expect(deps.calls).toEqual(["env"]);
  });

  test("tenant_code_legacy short-circuits to null, skipping ALL steps", async () => {
    const deps = makeDeps({
      async resolvePublicTenantByHost() {
        deps.calls.push("host");
        return HOST_TENANT;
      },
      async resolveDefaultPublicTenantFromEnv() {
        deps.calls.push("env");
        return ENV_TENANT;
      },
      async resolveDefaultPublicTenantFromSetupState() {
        deps.calls.push("setup");
        return SETUP_TENANT;
      }
    });
    const result = await resolvePublicTenantFromRequest(
      FAKE_SQL,
      "tenant.example.com",
      { mode: "tenant_code_legacy" },
      deps
    );
    expect(result).toBeNull();
    expect(deps.calls).toEqual([]);
  });

  test("everything missing resolves to null", async () => {
    const deps = makeDeps();
    const result = await resolvePublicTenantFromRequest(
      FAKE_SQL,
      "unmapped.example.com",
      { mode: "host_default" },
      deps
    );
    expect(result).toBeNull();
    expect(deps.calls).toEqual(["host", "env", "setup"]);
  });
});
