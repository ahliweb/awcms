import { describe, expect, test } from "bun:test";

import { comparePermissions } from "../src/modules/module-management/domain/permission-sync";

describe("comparePermissions", () => {
  test("synced when descriptor and catalog agree on description", () => {
    const result = comparePermissions(
      [
        {
          moduleKey: "email",
          activityCode: "template",
          action: "read",
          description: "Read email templates"
        }
      ],
      [
        {
          moduleKey: "email",
          activityCode: "template",
          action: "read",
          description: "Read email templates"
        }
      ]
    );

    expect(result).toEqual([
      {
        moduleKey: "email",
        activityCode: "template",
        action: "read",
        status: "synced",
        descriptorDescription: "Read email templates",
        catalogDescription: "Read email templates"
      }
    ]);
  });

  test("missing when declared in the descriptor but absent from the catalog", () => {
    const result = comparePermissions(
      [
        {
          moduleKey: "email",
          activityCode: "template",
          action: "delete",
          description: "Delete email templates"
        }
      ],
      []
    );

    expect(result).toEqual([
      {
        moduleKey: "email",
        activityCode: "template",
        action: "delete",
        status: "missing",
        descriptorDescription: "Delete email templates",
        catalogDescription: null
      }
    ]);
  });

  test("orphaned when present in the catalog but no descriptor declares it", () => {
    const result = comparePermissions(
      [],
      [
        {
          moduleKey: "tenant_admin",
          activityCode: "office_management",
          action: "read",
          description: "Read office records"
        }
      ]
    );

    expect(result).toEqual([
      {
        moduleKey: "tenant_admin",
        activityCode: "office_management",
        action: "read",
        status: "orphaned",
        descriptorDescription: null,
        catalogDescription: "Read office records"
      }
    ]);
  });

  test("mismatched_description when present in both but descriptions differ", () => {
    const result = comparePermissions(
      [
        {
          moduleKey: "email",
          activityCode: "template",
          action: "read",
          description: "Read templates (new wording)"
        }
      ],
      [
        {
          moduleKey: "email",
          activityCode: "template",
          action: "read",
          description: "Read templates (old wording)"
        }
      ]
    );

    expect(result).toEqual([
      {
        moduleKey: "email",
        activityCode: "template",
        action: "read",
        status: "mismatched_description",
        descriptorDescription: "Read templates (new wording)",
        catalogDescription: "Read templates (old wording)"
      }
    ]);
  });

  test("a null catalog description never equals a descriptor description (mismatched, not synced)", () => {
    const result = comparePermissions(
      [
        {
          moduleKey: "email",
          activityCode: "template",
          action: "read",
          description: "Read templates"
        }
      ],
      [
        {
          moduleKey: "email",
          activityCode: "template",
          action: "read",
          description: null
        }
      ]
    );

    expect(result).toEqual([
      {
        moduleKey: "email",
        activityCode: "template",
        action: "read",
        status: "mismatched_description",
        descriptorDescription: "Read templates",
        catalogDescription: null
      }
    ]);
  });

  test("sorts entries by module/activity/action for stable output", () => {
    const result = comparePermissions(
      [
        {
          moduleKey: "email",
          activityCode: "template",
          action: "update",
          description: "Update"
        },
        {
          moduleKey: "email",
          activityCode: "template",
          action: "create",
          description: "Create"
        }
      ],
      []
    );

    expect(result.map((entry) => entry.action)).toEqual(["create", "update"]);
  });
});
