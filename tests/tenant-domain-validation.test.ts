import { describe, expect, test } from "bun:test";

import {
  validateCreateTenantDomainInput,
  validateUpdateTenantDomainInput
} from "../src/modules/tenant-domain/domain/tenant-domain-validation";

describe("validateCreateTenantDomainInput", () => {
  test("accepts a plain hostname and normalizes it", () => {
    const result = validateCreateTenantDomainInput({
      hostname: "Tenant.Example.COM"
    });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value.hostname).toBe("Tenant.Example.COM");
    expect(result.value.normalizedHostname).toBe("tenant.example.com");
    // Defaults.
    expect(result.value.domainType).toBe("custom_domain");
    expect(result.value.routeMode).toBe("canonical");
    expect(result.value.verificationMethod).toBeNull();
    expect(result.value.redirectToPrimary).toBe(false);
  });

  test("rejects a missing/blank hostname", () => {
    for (const hostname of [undefined, "", "   "]) {
      const result = validateCreateTenantDomainInput({ hostname });
      expect(result.valid).toBe(false);
      if (result.valid) continue;
      expect(result.errors.some((e) => e.field === "hostname")).toBe(true);
    }
  });

  test("rejects a hostname carrying a port (never silently strips it)", () => {
    const result = validateCreateTenantDomainInput({
      hostname: "example.com:8443"
    });
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(
      result.errors.some(
        (e) => e.field === "hostname" && e.message.includes("port")
      )
    ).toBe(true);
  });

  test("rejects an underscore/IPv6/malformed hostname shape", () => {
    for (const hostname of ["_dmarc.example.com", "[::1]", "exa mple.com"]) {
      const result = validateCreateTenantDomainInput({ hostname });
      expect(result.valid).toBe(false);
    }
  });

  test("rejects an unknown domainType / routeMode / verificationMethod", () => {
    const result = validateCreateTenantDomainInput({
      hostname: "a.example.com",
      domainType: "apex",
      routeMode: "nonsense",
      verificationMethod: "carrier_pigeon"
    });
    expect(result.valid).toBe(false);
    if (result.valid) return;
    const fields = result.errors.map((e) => e.field);
    expect(fields).toContain("domainType");
    expect(fields).toContain("routeMode");
    expect(fields).toContain("verificationMethod");
  });

  test("accepts a full valid record with dns_txt method", () => {
    const result = validateCreateTenantDomainInput({
      hostname: "shop.example.com",
      domainType: "custom_domain",
      routeMode: "canonical",
      verificationMethod: "dns_txt",
      verificationRecordName: "_awcms-verify.shop.example.com",
      verificationRecordValue: "awcms-verify=abc123",
      redirectToPrimary: true
    });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value.verificationMethod).toBe("dns_txt");
    expect(result.value.redirectToPrimary).toBe(true);
  });
});

describe("validateUpdateTenantDomainInput", () => {
  test("rejects an empty patch body", () => {
    const result = validateUpdateTenantDomainInput({});
    expect(result.valid).toBe(false);
  });

  test('refuses status: "active" (must go through verify)', () => {
    const result = validateUpdateTenantDomainInput({ status: "active" });
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(
      result.errors.some(
        (e) => e.field === "status" && e.message.includes("verify")
      )
    ).toBe(true);
  });

  test("accepts an updatable status", () => {
    for (const status of ["pending_verification", "suspended", "failed"]) {
      const result = validateUpdateTenantDomainInput({ status });
      expect(result.valid).toBe(true);
    }
  });

  test("tri-state: null clears verification fields, omit leaves unchanged", () => {
    const cleared = validateUpdateTenantDomainInput({
      verificationMethod: null,
      verificationRecordName: null
    });
    expect(cleared.valid).toBe(true);
    if (!cleared.valid) return;
    expect(cleared.value.verificationMethod).toBeNull();
    expect(cleared.value.verificationRecordName).toBeNull();

    const partial = validateUpdateTenantDomainInput({
      routeMode: "legacy_blog"
    });
    expect(partial.valid).toBe(true);
    if (!partial.valid) return;
    expect(partial.value).not.toHaveProperty("verificationMethod");
    expect(partial.value.routeMode).toBe("legacy_blog");
  });

  test("hostname is not an updatable field", () => {
    const result = validateUpdateTenantDomainInput({
      hostname: "new.example.com"
    });
    // hostname is ignored — with nothing else present this is an empty patch.
    expect(result.valid).toBe(false);
  });
});
