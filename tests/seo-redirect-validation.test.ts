/**
 * Unit tests for the `seo_distribution` redirect ADMIN-INPUT validation (ADR-0039)
 * — the untrusted-body validators every write path (create/update/import/capture)
 * runs first, plus the redirect-settings and URL-change planners. Pure, no I/O.
 */
import { describe, expect, test } from "bun:test";

import {
  validateRedirectInput,
  validateRedirectUpdate
} from "../src/modules/seo-distribution/domain/redirect-rule";
import { validateRedirectSettings } from "../src/modules/seo-distribution/domain/redirect-settings";
import { planUrlChangeRedirect } from "../src/modules/seo-distribution/domain/url-change-plan";

const HOSTS = ["example.com"];

describe("validateRedirectInput", () => {
  test("accepts a minimal relative rule and derives defaults", () => {
    const r = validateRedirectInput(
      { sourcePath: "/old", target: "/new" },
      { allowedHosts: HOSTS }
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.normalizedSourcePath).toBe("/old");
      expect(r.value.targetType).toBe("relative_same_tenant");
      expect(r.value.statusCode).toBe(301);
      expect(r.value.state).toBe("active");
      expect(r.value.origin).toBe("manual");
    }
  });

  test("accepts an absolute own-host target as verified_external", () => {
    const r = validateRedirectInput(
      { sourcePath: "/old", target: "https://example.com/new" },
      { allowedHosts: HOSTS }
    );
    expect(r.ok && r.value.targetType).toBe("verified_external");
  });

  test("rejects a cross-host target (open-redirect)", () => {
    const r = validateRedirectInput(
      { sourcePath: "/old", target: "https://evil.com/new" },
      { allowedHosts: HOSTS }
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.field === "target")).toBe(true);
  });

  test("rejects an ineligible source path (admin hijack) at WRITE time", () => {
    const r = validateRedirectInput(
      { sourcePath: "/admin/secret", target: "/new" },
      { allowedHosts: HOSTS }
    );
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.errors.some((e) => e.field === "sourcePath")).toBe(true);
  });

  test("rejects a self-redirect", () => {
    const r = validateRedirectInput(
      { sourcePath: "/x", target: "/x" },
      { allowedHosts: HOSTS }
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.field === "target")).toBe(true);
  });

  test("rejects an invalid status code / state / effective range", () => {
    expect(
      validateRedirectInput(
        { sourcePath: "/a", target: "/b", statusCode: 418 },
        { allowedHosts: HOSTS }
      ).ok
    ).toBe(false);
    expect(
      validateRedirectInput(
        { sourcePath: "/a", target: "/b", state: "bogus" },
        { allowedHosts: HOSTS }
      ).ok
    ).toBe(false);
    expect(
      validateRedirectInput(
        {
          sourcePath: "/a",
          target: "/b",
          effectiveFrom: "2026-02-01T00:00:00Z",
          effectiveUntil: "2026-01-01T00:00:00Z"
        },
        { allowedHosts: HOSTS }
      ).ok
    ).toBe(false);
  });

  test("rejects a domain scope outside the tenant's verified hosts", () => {
    const r = validateRedirectInput(
      { sourcePath: "/a", target: "/b", domainScopeHost: "not-mine.com" },
      { allowedHosts: HOSTS }
    );
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.errors.some((e) => e.field === "domainScopeHost")).toBe(true);
  });

  test("rejects a non-object body", () => {
    expect(validateRedirectInput(null, { allowedHosts: HOSTS }).ok).toBe(false);
    expect(validateRedirectInput("x", { allowedHosts: HOSTS }).ok).toBe(false);
  });
});

describe("validateRedirectUpdate", () => {
  test("accepts a target-only update (source immutable, supplied separately)", () => {
    const r = validateRedirectUpdate({ target: "/new" }, "/src", {
      allowedHosts: HOSTS
    });
    expect(r.ok && r.value.target).toBe("/new");
  });

  test("rejects a self-redirect against the immutable source", () => {
    const r = validateRedirectUpdate({ target: "/src" }, "/src", {
      allowedHosts: HOSTS
    });
    expect(r.ok).toBe(false);
  });

  test("rejects a cross-host target", () => {
    const r = validateRedirectUpdate({ target: "https://evil.com/x" }, "/src", {
      allowedHosts: HOSTS
    });
    expect(r.ok).toBe(false);
  });
});

describe("validateRedirectSettings", () => {
  test("accepts an empty body and applies defaults", () => {
    const r = validateRedirectSettings({});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.legacyBlogRedirectEnabled).toBe(false);
      expect(r.value.urlChangeAutoPolicy).toBe("propose");
    }
  });

  test("accepts valid values", () => {
    const r = validateRedirectSettings({
      legacyBlogRedirectEnabled: true,
      urlChangeAutoPolicy: "create"
    });
    expect(r.ok && r.value.urlChangeAutoPolicy).toBe("create");
  });

  test("rejects a bad policy and a non-boolean toggle", () => {
    expect(validateRedirectSettings({ urlChangeAutoPolicy: "bogus" }).ok).toBe(
      false
    );
    expect(
      validateRedirectSettings({ legacyBlogRedirectEnabled: "yes" }).ok
    ).toBe(false);
    expect(validateRedirectSettings(null).ok).toBe(false);
  });
});

describe("planUrlChangeRedirect", () => {
  test("policy skip → no rule", () => {
    const plan = planUrlChangeRedirect(
      { oldPath: "/a", newPath: "/b", changeType: "slug_change" },
      "skip",
      HOSTS
    );
    expect(plan.action).toBe("skip");
  });

  test("policy propose → an INACTIVE rule with the change-type origin", () => {
    const plan = planUrlChangeRedirect(
      { oldPath: "/a", newPath: "/b", changeType: "slug_change" },
      "propose",
      HOSTS
    );
    expect(plan.action).toBe("propose");
    if (plan.action === "propose") {
      expect(plan.rule.state).toBe("inactive");
      expect(plan.rule.origin).toBe("slug_change");
    }
  });

  test("policy create → an ACTIVE rule", () => {
    const plan = planUrlChangeRedirect(
      { oldPath: "/a", newPath: "/b", changeType: "domain_change" },
      "create",
      HOSTS
    );
    expect(plan.action).toBe("create");
    if (plan.action === "create") expect(plan.rule.state).toBe("active");
  });

  test("an unsafe/self change is reported invalid, not silently created", () => {
    const plan = planUrlChangeRedirect(
      { oldPath: "/a", newPath: "/a", changeType: "slug_change" },
      "create",
      HOSTS
    );
    expect(plan.action).toBe("invalid");
  });
});
