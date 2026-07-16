import { describe, expect, test } from "bun:test";

import {
  filterVisibleNavigationEntries,
  type NavigationCandidate
} from "../src/modules/module-management/domain/navigation-registry";

function candidate(
  overrides: Partial<NavigationCandidate> = {}
): NavigationCandidate {
  return {
    moduleKey: "module_management",
    moduleStatus: "active",
    labelKey: "admin.layout.nav_modules",
    path: "/admin/modules",
    order: 0,
    ...overrides
  };
}

describe("filterVisibleNavigationEntries", () => {
  test("visible when no requiredPermission is declared", () => {
    const result = filterVisibleNavigationEntries([candidate()], {
      grantedPermissionKeys: new Set(),
      tenantDisabledModuleKeys: new Set()
    });

    expect(result).toHaveLength(1);
  });

  test("visible when the caller holds the declared requiredPermission", () => {
    const result = filterVisibleNavigationEntries(
      [candidate({ requiredPermission: "module_management.modules.read" })],
      {
        grantedPermissionKeys: new Set(["module_management.modules.read"]),
        tenantDisabledModuleKeys: new Set()
      }
    );

    expect(result).toHaveLength(1);
  });

  test("hidden when the caller lacks the declared requiredPermission", () => {
    const result = filterVisibleNavigationEntries(
      [candidate({ requiredPermission: "module_management.modules.read" })],
      {
        grantedPermissionKeys: new Set(),
        tenantDisabledModuleKeys: new Set()
      }
    );

    expect(result).toHaveLength(0);
  });

  test("hidden when the module is globally disabled", () => {
    const result = filterVisibleNavigationEntries(
      [candidate({ moduleStatus: "disabled" })],
      {
        grantedPermissionKeys: new Set(),
        tenantDisabledModuleKeys: new Set()
      }
    );

    expect(result).toHaveLength(0);
  });

  test("still visible for experimental/deprecated/maintenance status", () => {
    for (const moduleStatus of [
      "experimental",
      "deprecated",
      "maintenance"
    ] as const) {
      const result = filterVisibleNavigationEntries(
        [candidate({ moduleStatus })],
        {
          grantedPermissionKeys: new Set(),
          tenantDisabledModuleKeys: new Set()
        }
      );

      expect(result).toHaveLength(1);
    }
  });

  test("hidden when the tenant has disabled that module", () => {
    const result = filterVisibleNavigationEntries(
      [candidate({ moduleKey: "form_drafts" })],
      {
        grantedPermissionKeys: new Set(),
        tenantDisabledModuleKeys: new Set(["form_drafts"])
      }
    );

    expect(result).toHaveLength(0);
  });

  test("a tenant-disabled module doesn't hide a different module's entry", () => {
    const result = filterVisibleNavigationEntries(
      [
        candidate({ moduleKey: "form_drafts", path: "/admin/form-drafts" }),
        candidate({ moduleKey: "module_management", path: "/admin/modules" })
      ],
      {
        grantedPermissionKeys: new Set(),
        tenantDisabledModuleKeys: new Set(["form_drafts"])
      }
    );

    expect(result).toEqual([
      candidate({ moduleKey: "module_management", path: "/admin/modules" })
    ]);
  });

  test("sorts survivors by order ascending", () => {
    const result = filterVisibleNavigationEntries(
      [
        candidate({ path: "/admin/b", order: 20 }),
        candidate({ path: "/admin/a", order: 10 })
      ],
      {
        grantedPermissionKeys: new Set(),
        tenantDisabledModuleKeys: new Set()
      }
    );

    expect(result.map((entry) => entry.path)).toEqual(["/admin/a", "/admin/b"]);
  });
});
