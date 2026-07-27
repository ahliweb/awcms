import { describe, expect, test } from "bun:test";

import { getModuleByKey, listModules } from "../src/modules";
import { tenantDomainModule } from "../src/modules/tenant-domain/module";

// The six permissions seeded by sql/047_awcms_tenant_domain_permissions.sql,
// verbatim. The descriptor's `permissions` array must match this list exactly
// (activityCode/action/description) or Module Management's permission
// sync/status report will show `missing`/`mismatched_description`.
const MIGRATION_047_PERMISSIONS = [
  {
    activityCode: "domains",
    action: "read",
    description: "Read tenant domain/subdomain mappings"
  },
  {
    activityCode: "domains",
    action: "create",
    description: "Add a tenant domain/subdomain mapping"
  },
  {
    activityCode: "domains",
    action: "update",
    description: "Update a tenant domain/subdomain mapping"
  },
  {
    activityCode: "domains",
    action: "delete",
    description: "Soft delete a tenant domain/subdomain mapping"
  },
  {
    activityCode: "domains",
    action: "verify",
    description: "Verify ownership of a tenant domain/subdomain"
  },
  {
    activityCode: "domains",
    action: "set_primary",
    description: "Set a tenant domain as the active primary domain"
  }
];

describe("tenant_domain module descriptor (ported from awcms-micro)", () => {
  test("listModules() includes tenant_domain", () => {
    expect(listModules().some((m) => m.key === "tenant_domain")).toBe(true);
    expect(getModuleByKey("tenant_domain")).toBe(tenantDomainModule);
  });

  test("descriptor shape", () => {
    expect(tenantDomainModule.key).toBe("tenant_domain");
    expect(tenantDomainModule.status).toBe("active");
    // Registered as "domain" in this base (the port instruction), like the
    // other directly-in-base website modules.
    expect(tenantDomainModule.type).toBe("domain");
    expect(tenantDomainModule.dependencies).toEqual([
      "tenant_admin",
      "identity_access"
    ]);
  });

  test("api points at the module fragment + management basePath", () => {
    expect(tenantDomainModule.api?.basePath).toBe("/api/v1/tenant/domains");
    expect(tenantDomainModule.api?.openApiPath).toBe(
      "openapi/modules/tenant-domain.openapi.yaml"
    );
  });

  test("navigation.path is permission-gated on read", () => {
    expect(tenantDomainModule.navigation).toHaveLength(1);
    expect(tenantDomainModule.navigation?.[0]?.path).toBe(
      "/admin/tenant/domains"
    );
    expect(tenantDomainModule.navigation?.[0]?.requiredPermission).toBe(
      "tenant_domain.domains.read"
    );
  });

  test("permissions array matches migration 047's seed exactly", () => {
    expect(tenantDomainModule.permissions).toEqual(MIGRATION_047_PERMISSIONS);
  });

  test("permission keys reproduce the six tenant_domain.domains.* keys", () => {
    const permissionKeys = (tenantDomainModule.permissions ?? []).map(
      (p) => `${tenantDomainModule.key}.${p.activityCode}.${p.action}`
    );

    expect(permissionKeys).toEqual([
      "tenant_domain.domains.read",
      "tenant_domain.domains.create",
      "tenant_domain.domains.update",
      "tenant_domain.domains.delete",
      "tenant_domain.domains.verify",
      "tenant_domain.domains.set_primary"
    ]);
  });

  test("settings.defaults only sets manual DNS verification mode", () => {
    expect(tenantDomainModule.settings?.defaults).toEqual({
      defaultVerificationMethod: "manual"
    });
  });

  test("settings.defaults never contains a secret-shaped key or value", () => {
    const defaults = tenantDomainModule.settings?.defaults ?? {};
    const serialized = JSON.stringify(defaults).toLowerCase();

    for (const forbidden of [
      "password",
      "token",
      "secret",
      "credential",
      "apikey",
      "api_key"
    ]) {
      expect(serialized).not.toContain(forbidden);
    }

    expect(defaults).not.toHaveProperty("provider");
    expect(defaults).not.toHaveProperty("cloudflareApiToken");
  });

  test("the DNS sync job is declared, with a schedule an operator can act on", () => {
    // This used to assert `jobs` was UNDEFINED, pinning the defect in place:
    // `scripts/tenant-domain-dns-sync.ts` was already in
    // `JOB_WORK_CLASS_REGISTRY` (so it was fully inside the capacity model)
    // while `GET /api/v1/modules/tenant_domain/jobs` returned nothing — the
    // one surface an operator reads to learn a job needs scheduling. A job
    // nobody schedules never runs, and nothing says so. `modules:jobs:check`
    // now compares the two registries; this pins the module's own half.
    const job = tenantDomainModule.jobs?.find(
      (entry) => entry.command === "bun run tenant-domain:dns:sync"
    );

    expect(job).toBeDefined();
    expect(job!.recommendedSchedule?.trim()).toBeTruthy();
    // The outbound-call condition belongs in the descriptor, not only in the
    // script: `safeInOfflineLan` is how an offline/LAN operator decides.
    expect(job!.environmentNotes).toContain("TENANT_DOMAIN_DNS_PROVIDER");
    expect(job!.safeInOfflineLan).toBe(true);
  });

  test("the module declares no health contract", () => {
    expect(tenantDomainModule.health).toBeUndefined();
  });
});
