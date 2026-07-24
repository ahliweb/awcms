import { describe, expect, test } from "bun:test";

import { getModuleByKey, listModules } from "../src/modules";
import { seoDistributionModule } from "../src/modules/seo-distribution/module";
import { blogContentModule } from "../src/modules/blog-content/module";
import { CAPABILITY_CONTRACT_VERSIONS } from "../src/modules/_shared/capability-contract-versions";

describe("seo_distribution module descriptor (ADR-0038 discovery + ADR-0039 redirect governance)", () => {
  test("listModules() includes seo_distribution", () => {
    expect(listModules().some((m) => m.key === "seo_distribution")).toBe(true);
    expect(getModuleByKey("seo_distribution")).toBe(seoDistributionModule);
  });

  test("descriptor shape: domain module, v0.2.0 (redirect governance), Core-only deps", () => {
    expect(seoDistributionModule.key).toBe("seo_distribution");
    expect(seoDistributionModule.status).toBe("active");
    expect(seoDistributionModule.type).toBe("domain");
    // 0.1.0 = discovery (ADR-0038); 0.2.0 adds the redirect-governance scope
    // (ADR-0039) — still a Core-only-deps consumer/aggregator module.
    expect(seoDistributionModule.version).toBe("0.2.0");
    expect(seoDistributionModule.dependencies).toEqual([
      "tenant_admin",
      "identity_access"
    ]);
  });

  test("CONSUMES seo_facts (blog_content) + media_library, both optional; PROVIDES nothing", () => {
    expect(seoDistributionModule.capabilities?.provides).toBeUndefined();
    expect(seoDistributionModule.capabilities?.consumes).toEqual([
      { capability: "seo_facts", providedBy: "blog_content", optional: true },
      {
        capability: "media_library",
        providedBy: "media_library",
        optional: true
      }
    ]);
  });

  test("permissions: config.{read,update} (ADR-0038) + redirect.{read,create,update,delete} + not_found.{read,update} (ADR-0039)", () => {
    const perms = (seoDistributionModule.permissions ?? []).map(
      (p) => `${p.activityCode}.${p.action}`
    );
    expect(perms.sort()).toEqual([
      "config.read",
      "config.update",
      "not_found.read",
      "not_found.update",
      "redirect.create",
      "redirect.delete",
      "redirect.read",
      "redirect.update"
    ]);
  });

  test("dataLifecycle: governs the 404-telemetry table (ADR-0039); no jobs/events/navigation", () => {
    // ADR-0038 shipped no dataLifecycle; ADR-0039's redirect scope adds the
    // privacy-minimized 404-observations table, which MUST be governed.
    const lifecycle = seoDistributionModule.dataLifecycle ?? [];
    expect(lifecycle.map((d) => d.key)).toEqual([
      "seo_distribution.not_found_observations"
    ]);
    expect(lifecycle[0]?.tableName).toBe("awcms_seo_not_found_observations");
    expect(lifecycle[0]?.executionMode).toBe("generic");
    expect(lifecycle[0]?.deletion.mode).toBe("hard_delete");
    expect(seoDistributionModule.jobs).toBeUndefined();
    expect(seoDistributionModule.events).toBeUndefined();
    expect(seoDistributionModule.navigation).toBeUndefined();
  });

  test("api basePath is /api/v1/seo with its own fragment", () => {
    expect(seoDistributionModule.api?.basePath).toBe("/api/v1/seo");
    expect(seoDistributionModule.api?.openApiPath).toBe(
      "openapi/modules/seo-distribution.openapi.yaml"
    );
  });
});

describe("blog_content is the single seo_facts provider (seam wiring)", () => {
  test("blog_content provides public_content + seo_facts", () => {
    expect(blogContentModule.capabilities?.provides).toEqual([
      "public_content",
      "seo_facts"
    ]);
  });

  test("exactly one module provides seo_facts in the registry", () => {
    const providers = listModules().filter((m) =>
      (m.capabilities?.provides ?? []).includes("seo_facts")
    );
    expect(providers.map((m) => m.key)).toEqual(["blog_content"]);
  });

  test("seo_facts capability version is registered (ADR-0015 rule)", () => {
    expect(CAPABILITY_CONTRACT_VERSIONS.seo_facts).toBe("1.1.0");
  });
});
