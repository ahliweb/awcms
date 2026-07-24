import { describe, expect, test } from "bun:test";

import {
  DEFAULT_TENANT_DOMAIN_CLOUDFLARE_TIMEOUT_MS,
  isKnownTenantDomainDnsProvider,
  resolveTenantDomainCloudflareTimeoutMs
} from "../src/modules/tenant-domain/domain/tenant-domain-dns-config";

describe("tenant-domain DNS config", () => {
  test("isKnownTenantDomainDnsProvider only accepts manual/cloudflare", () => {
    expect(isKnownTenantDomainDnsProvider("manual")).toBe(true);
    expect(isKnownTenantDomainDnsProvider("cloudflare")).toBe(true);
    expect(isKnownTenantDomainDnsProvider("route53")).toBe(false);
    expect(isKnownTenantDomainDnsProvider(undefined)).toBe(false);
    expect(isKnownTenantDomainDnsProvider("")).toBe(false);
  });

  test("timeout falls back to the default for unset/invalid/non-positive values", () => {
    expect(resolveTenantDomainCloudflareTimeoutMs({})).toBe(
      DEFAULT_TENANT_DOMAIN_CLOUDFLARE_TIMEOUT_MS
    );
    expect(
      resolveTenantDomainCloudflareTimeoutMs({
        TENANT_DOMAIN_CLOUDFLARE_TIMEOUT_MS: "not-a-number"
      })
    ).toBe(DEFAULT_TENANT_DOMAIN_CLOUDFLARE_TIMEOUT_MS);
    expect(
      resolveTenantDomainCloudflareTimeoutMs({
        TENANT_DOMAIN_CLOUDFLARE_TIMEOUT_MS: "-5"
      })
    ).toBe(DEFAULT_TENANT_DOMAIN_CLOUDFLARE_TIMEOUT_MS);
  });

  test("timeout uses a valid positive override", () => {
    expect(
      resolveTenantDomainCloudflareTimeoutMs({
        TENANT_DOMAIN_CLOUDFLARE_TIMEOUT_MS: "12000"
      })
    ).toBe(12000);
  });
});
