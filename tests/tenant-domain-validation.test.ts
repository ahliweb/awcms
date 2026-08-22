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
    expect(result.value.redirectToPrimary).toBe(false);
    // ADR-0106: the challenge is not an input at all any more, so there is no
    // `verificationMethod` on the accepted value to default.
    expect(result.value).not.toHaveProperty("verificationMethod");
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
      redirectToPrimary: true
    });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value.domainType).toBe("custom_domain");
    expect(result.value.redirectToPrimary).toBe(true);
  });

  test("REFUSES a caller-supplied challenge rather than ignoring it (ADR-0106)", () => {
    // The heart of the decision. A caller that chooses both the record name and
    // the record value can point them at something that already exists in a
    // zone it does not control, so a check against them proves nothing.
    // Dropping the fields silently would leave the caller believing it had
    // chosen what would be checked.
    for (const field of [
      "verificationMethod",
      "verificationRecordName",
      "verificationRecordValue"
    ]) {
      const result = validateCreateTenantDomainInput({
        hostname: "shop.example.com",
        [field]: "anything at all"
      });

      expect(result.valid, `${field} was accepted`).toBe(false);
      if (result.valid) continue;
      expect(result.errors.some((e) => e.field === field)).toBe(true);
    }
  });

  test("refuses a hostname too long to carry the challenge record", () => {
    // `_awcms-verify.` + hostname must fit in a DNS name. Refused at CREATE so
    // a row that could never be verified is never written.
    const label = "a".repeat(60);
    const hostname = [label, label, label, label, "com"].join(".");

    expect(hostname.length).toBeGreaterThan(239);

    const result = validateCreateTenantDomainInput({ hostname });

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(
      result.errors.some(
        (e) => e.field === "hostname" && e.message.includes("verification")
      )
    ).toBe(true);
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

  test("REFUSES the server-managed challenge fields on PATCH too (ADR-0106)", () => {
    // These used to be tri-state (omit / null / set). They are now refused in
    // every form, including `null`: clearing the challenge would put a row back
    // into the state that made verification meaningless in the first place.
    for (const value of [null, "dns_txt", "_awcms-verify.example.com"]) {
      const result = validateUpdateTenantDomainInput({
        verificationMethod: value
      });

      expect(result.valid, `verificationMethod: ${String(value)}`).toBe(false);
      if (result.valid) continue;
      expect(result.errors.some((e) => e.field === "verificationMethod")).toBe(
        true
      );
    }

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
