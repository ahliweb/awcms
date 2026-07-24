import { describe, expect, test } from "bun:test";

import {
  resolveTenantDomainDnsProvider,
  validateDnsRecordInput
} from "../src/modules/tenant-domain/infrastructure/cloudflare-dns-adapter";

const ROOT = "platform.example";

describe("validateDnsRecordInput", () => {
  test("rejects an unknown record type", () => {
    expect(
      validateDnsRecordInput(
        { recordType: "MX", recordName: `_x.${ROOT}`, recordValue: "v" },
        ROOT
      )
    ).toContain("recordType");
  });

  test("rejects a recordName outside the platform root domain", () => {
    expect(
      validateDnsRecordInput(
        {
          recordType: "TXT",
          recordName: "_x.attacker.example",
          recordValue: "v"
        },
        ROOT
      )
    ).toContain("root domain");
  });

  test("accepts an underscore-prefixed TXT record within the root", () => {
    expect(
      validateDnsRecordInput(
        {
          recordType: "TXT",
          recordName: `_awcms-verify.${ROOT}`,
          recordValue: "awcms-verify=abc"
        },
        ROOT
      )
    ).toBeNull();
  });

  test("rejects a TXT value with CR/LF (header/record injection)", () => {
    expect(
      validateDnsRecordInput(
        {
          recordType: "TXT",
          recordName: `_x.${ROOT}`,
          recordValue: "line1\r\nline2"
        },
        ROOT
      )
    ).toContain("recordValue");
  });

  test("CNAME target must be a plausible hostname", () => {
    expect(
      validateDnsRecordInput(
        {
          recordType: "CNAME",
          recordName: `www.${ROOT}`,
          recordValue: "not a host"
        },
        ROOT
      )
    ).toContain("recordValue");
    expect(
      validateDnsRecordInput(
        {
          recordType: "CNAME",
          recordName: `www.${ROOT}`,
          recordValue: "target.example.com"
        },
        ROOT
      )
    ).toBeNull();
  });
});

describe("resolveTenantDomainDnsProvider (absent-safe, never throws)", () => {
  test("unset provider degrades to a clean misconfigured-result provider", async () => {
    const provider = resolveTenantDomainDnsProvider({});
    const created = await provider.createVerificationRecord({
      recordType: "TXT",
      recordName: `_x.${ROOT}`,
      recordValue: "v"
    });
    expect(created.ok).toBe(false);
  });

  test('"manual" is explicitly not an automated provider', async () => {
    const provider = resolveTenantDomainDnsProvider({
      TENANT_DOMAIN_DNS_PROVIDER: "manual"
    });
    const checked = await provider.checkVerificationStatus({
      recordType: "TXT",
      recordName: `_x.${ROOT}`,
      expectedValue: "v"
    });
    expect(checked.ok).toBe(false);
    if (checked.ok) return;
    expect(checked.error).toContain("manual");
  });

  test("cloudflare selected but missing config still does not throw", async () => {
    const provider = resolveTenantDomainDnsProvider({
      TENANT_DOMAIN_DNS_PROVIDER: "cloudflare"
    });
    const created = await provider.createVerificationRecord({
      recordType: "TXT",
      recordName: `_x.${ROOT}`,
      recordValue: "v"
    });
    expect(created.ok).toBe(false);
    if (created.ok) return;
    expect(created.error).toContain("not configured");
  });
});
