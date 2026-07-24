import { describe, expect, test } from "bun:test";

import { getModuleByKey, listModules } from "../src/modules";
import { seoDistributionModule } from "../src/modules/seo-distribution/module";
import { blogContentModule } from "../src/modules/blog-content/module";
import { CAPABILITY_CONTRACT_VERSIONS } from "../src/modules/_shared/capability-contract-versions";

describe("seo_distribution module descriptor (ADR-0038, discovery scope)", () => {
  test("listModules() includes seo_distribution", () => {
    expect(listModules().some((m) => m.key === "seo_distribution")).toBe(true);
    expect(getModuleByKey("seo_distribution")).toBe(seoDistributionModule);
  });

  test("descriptor shape: domain module, v0.1.0, Core-only deps", () => {
    expect(seoDistributionModule.key).toBe("seo_distribution");
    expect(seoDistributionModule.status).toBe("active");
    expect(seoDistributionModule.type).toBe("domain");
    expect(seoDistributionModule.version).toBe("0.1.0");
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

  test("permissions are config.read + config.update ONLY (redirect/not_found deferred)", () => {
    const perms = (seoDistributionModule.permissions ?? []).map(
      (p) => `${p.activityCode}.${p.action}`
    );
    expect(perms.sort()).toEqual(["config.read", "config.update"]);
  });

  test("DEFERRALS: no dataLifecycle descriptor, no jobs/events/navigation", () => {
    expect(seoDistributionModule.dataLifecycle).toBeUndefined();
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
