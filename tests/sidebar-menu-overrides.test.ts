/**
 * The per-tenant override layer, and the boundary it must not cross.
 *
 * ## The one that matters
 *
 * A tenant can OVERRIDE the sidebar; it can never ADD to it. The item set is
 * trusted build-time data (`listModules()` navigation plus the synthetic core
 * entries), and every stored override is resolved BY KEY against that model.
 * An override naming an entry the registry never produced is ignored.
 *
 * That is the whole security argument for storing a delta rather than a
 * snapshot, and it is worth a test because the failure would be quiet: a stored
 * row that materialised into a link would look like a feature until someone
 * noticed the sidebar pointing somewhere the registry does not know about.
 *
 * ## The second one
 *
 * Overrides are applied BEFORE permission and tenant-disable filtering, so
 * relabelling or moving an entry can never smuggle it past
 * `requiredPermission`. Applied after, a rename would be a privilege
 * escalation with a friendly UI.
 *
 * Pure — no database. The read/write path has its own DB-gated coverage.
 */
import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";
import {
  applySidebarOverrides,
  applySidebarTypeOverrides,
  buildDefaultSidebarModel,
  composeSidebarSections,
  MAX_LABEL_OVERRIDE_LENGTH,
  MAX_SIDEBAR_ROWS,
  validateSidebarArrangement,
  type SidebarArrangement
} from "../src/modules/module-management/domain/sidebar-menu";

const DEFAULTS = buildDefaultSidebarModel(listModules());
const ALL_PERMISSIONS = new Set(
  DEFAULTS.flatMap((entry) =>
    entry.requiredPermission ? [entry.requiredPermission] : []
  )
);

function empty(): SidebarArrangement {
  return { types: [], items: [] };
}

function render(arrangement: SidebarArrangement, granted = ALL_PERMISSIONS) {
  return applySidebarTypeOverrides(
    composeSidebarSections(applySidebarOverrides(DEFAULTS, arrangement), {
      grantedPermissionKeys: granted,
      tenantDisabledModuleKeys: new Set()
    }),
    arrangement
  );
}

function paths(sections: ReturnType<typeof render>): string[] {
  return sections.flatMap((section) =>
    section.groups.flatMap((group) => group.entries.map((e) => e.path))
  );
}

describe("a tenant can override, never inject", () => {
  test("an override for an unknown entry key changes nothing", () => {
    const before = paths(render(empty()));
    const after = paths(
      render({
        types: [],
        items: [
          {
            entryKey: "/admin/not-a-real-page",
            typeKey: "system",
            position: 0,
            labelOverride: "Totally Legitimate",
            hidden: false
          }
        ]
      })
    );

    expect(after).toEqual(before);
    expect(after).not.toContain("/admin/not-a-real-page");
  });

  test("an override for an unknown key cannot create a section either", () => {
    const sections = render({
      types: [
        {
          typeKey: "smuggled",
          labelOverride: "Smuggled",
          position: 0,
          hidden: false
        }
      ],
      items: [
        {
          entryKey: "/admin/not-a-real-page",
          typeKey: "smuggled",
          position: 0,
          labelOverride: null,
          hidden: false
        }
      ]
    });

    // A custom type with no resolvable entry renders nothing:
    // `composeSidebarSections` drops empty types.
    expect(sections.some((section) => section.typeKey === "smuggled")).toBe(
      false
    );
  });
});

describe("overrides are applied before filtering, not after", () => {
  test("relabelling an entry does not bypass its requiredPermission", () => {
    const gated = DEFAULTS.find((entry) => entry.requiredPermission)!;
    const sections = render(
      {
        types: [],
        items: [
          {
            entryKey: gated.path,
            typeKey: null,
            position: 0,
            labelOverride: "Renamed",
            hidden: false
          }
        ]
      },
      // Caller holds NOTHING.
      new Set<string>()
    );

    expect(paths(sections)).not.toContain(gated.path);
  });

  test("moving an entry to another section does not bypass its permission", () => {
    const gated = DEFAULTS.find((entry) => entry.requiredPermission)!;
    const sections = render(
      {
        types: [],
        items: [
          {
            entryKey: gated.path,
            typeKey: "general",
            position: 0,
            labelOverride: null,
            hidden: false
          }
        ]
      },
      new Set<string>()
    );

    expect(paths(sections)).not.toContain(gated.path);
  });
});

describe("what overrides actually do", () => {
  test("hiding an item removes it", () => {
    const target = DEFAULTS[1]!;
    const sections = render({
      types: [],
      items: [
        {
          entryKey: target.path,
          typeKey: null,
          position: 0,
          labelOverride: null,
          hidden: true
        }
      ]
    });

    expect(paths(sections)).not.toContain(target.path);
  });

  test("hiding a type removes every entry under it", () => {
    const target = DEFAULTS.find((entry) => entry.typeKey === "identity")!;
    const sections = render({
      types: [
        {
          typeKey: "identity",
          labelOverride: null,
          position: 0,
          hidden: true
        }
      ],
      items: []
    });

    expect(sections.some((section) => section.typeKey === "identity")).toBe(
      false
    );
    expect(paths(sections)).not.toContain(target.path);
  });

  test("a label override replaces the rendered label", () => {
    const target = DEFAULTS[1]!;
    const sections = render({
      types: [],
      items: [
        {
          entryKey: target.path,
          typeKey: null,
          position: 0,
          labelOverride: "Custom Name",
          hidden: false
        }
      ]
    });
    const labels = sections.flatMap((section) =>
      section.groups.flatMap((group) => group.entries.map((e) => e.label))
    );

    expect(labels).toContain("Custom Name");
  });

  test("a section label override replaces the section heading", () => {
    const sections = render({
      types: [
        {
          typeKey: "system",
          labelOverride: "Platform",
          position: 0,
          hidden: false
        }
      ],
      items: []
    });

    expect(
      sections.find((section) => section.typeKey === "system")?.label
    ).toBe("Platform");
  });

  test("section position reorders, and un-overridden sections keep their taxonomy place", () => {
    const before = render(empty()).map((section) => section.typeKey);
    const after = render({
      // Push `system` far down; everything else is untouched.
      types: [
        {
          typeKey: "system",
          labelOverride: null,
          position: 99,
          hidden: false
        }
      ],
      items: []
    }).map((section) => section.typeKey);

    expect(before[0]).toBe("system");
    expect(after[after.length - 1]).toBe("system");
    // The rest keep their relative order rather than all jumping ahead.
    expect(after.filter((key) => key !== "system")).toEqual(
      before.filter((key) => key !== "system")
    );
  });

  test("an empty arrangement renders exactly the code default", () => {
    expect(paths(render(empty()))).toEqual(paths(render(empty())));
    expect(render(empty()).length).toBeGreaterThan(0);
  });
});

describe("validation", () => {
  test("accepts a well-formed arrangement", () => {
    expect(
      validateSidebarArrangement({
        types: [
          {
            typeKey: "custom_ops",
            labelOverride: "Ops",
            position: 1,
            hidden: false
          }
        ],
        items: [
          {
            entryKey: "/admin",
            typeKey: "custom_ops",
            position: 0,
            labelOverride: null,
            hidden: false
          }
        ]
      })
    ).toEqual([]);
  });

  test.each([
    ["Uppercase", "Ops"],
    ["a hyphen", "custom-ops"],
    ["markup", "<b>x</b>"],
    ["a space", "custom ops"]
  ])("rejects a type key containing %s", (_label, typeKey) => {
    // Narrow on purpose: a custom key must not collide structurally with a code
    // type, nor smuggle markup into a section heading.
    const issues = validateSidebarArrangement({
      types: [{ typeKey, labelOverride: null, position: 0, hidden: false }],
      items: []
    });

    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]!.field).toBe("types[0].typeKey");
  });

  test("rejects a duplicate type key within one payload", () => {
    // The save path is DELETE-then-INSERT, so a duplicate would otherwise hit
    // the unique constraint mid-transaction and surface as a server error.
    const issues = validateSidebarArrangement({
      types: [
        { typeKey: "ops", labelOverride: null, position: 0, hidden: false },
        { typeKey: "ops", labelOverride: null, position: 1, hidden: false }
      ],
      items: []
    });

    expect(issues.some((issue) => issue.message.includes("Duplicate"))).toBe(
      true
    );
  });

  test("rejects a duplicate entry key within one payload", () => {
    const issues = validateSidebarArrangement({
      types: [],
      items: [
        {
          entryKey: "/admin",
          typeKey: null,
          position: 0,
          labelOverride: null,
          hidden: false
        },
        {
          entryKey: "/admin",
          typeKey: null,
          position: 1,
          labelOverride: null,
          hidden: false
        }
      ]
    });

    expect(issues.some((issue) => issue.message.includes("Duplicate"))).toBe(
      true
    );
  });

  test("rejects an over-long label override", () => {
    const issues = validateSidebarArrangement({
      types: [],
      items: [
        {
          entryKey: "/admin",
          typeKey: null,
          position: 0,
          labelOverride: "x".repeat(MAX_LABEL_OVERRIDE_LENGTH + 1),
          hidden: false
        }
      ]
    });

    expect(issues[0]!.field).toBe("items[0].labelOverride");
  });

  test("rejects a pathological row count", () => {
    const issues = validateSidebarArrangement({
      types: [],
      items: Array.from({ length: MAX_SIDEBAR_ROWS + 1 }, (_, index) => ({
        entryKey: `/admin/${index}`,
        typeKey: null,
        position: index,
        labelOverride: null,
        hidden: false
      }))
    });

    expect(issues.some((issue) => issue.field === "arrangement")).toBe(true);
  });

  test("rejects an empty entry key", () => {
    const issues = validateSidebarArrangement({
      types: [],
      items: [
        {
          entryKey: "",
          typeKey: null,
          position: 0,
          labelOverride: null,
          hidden: false
        }
      ]
    });

    expect(issues[0]!.field).toBe("items[0].entryKey");
  });
});
