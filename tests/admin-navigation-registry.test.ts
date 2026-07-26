/**
 * The admin sidebar and the filesystem must agree, in both directions.
 *
 * ## What this caught
 *
 * `ModuleDescriptor.navigation` was consumed three ways — path-conflict
 * validation in `module-composition.ts`, a write to `awcms_module_navigation`
 * in `descriptor-sync.ts`, and `GET /api/v1/modules` — while the sidebar in
 * `AdminLayout.astro` rendered a separate hand-written array. Nothing compared
 * them, and both had rotted:
 *
 * - **Three declared entries pointed at pages that do not exist**:
 *   `/admin/blog` (`blog_content`), `/admin/news-portal/homepage-sections` and
 *   `/admin/news-portal/ad-placements` (`news_portal`). All three were being
 *   synced to the database and served by the API as valid menu items. They came
 *   over with the descriptors when those modules were ported from awcms-mini,
 *   where the pages exist.
 * - **Eight pages that DO exist were unknown to the registry**: `/admin`,
 *   `/admin/profiles`, `/admin/users`, `/admin/roles`, `/admin/abac-policies`,
 *   `/admin/offices`, `/admin/modules`, `/admin/email-templates`.
 *
 * `modules:compose:check` validated that two modules never claim the same path.
 * It never validated that a path leads anywhere.
 *
 * ## Why a test rather than care
 *
 * The old arrangement was documented — `comments/module.ts` said outright that
 * the descriptor and the sidebar "must be kept in step" by hand. Three sibling
 * modules then failed to keep them in step, in a way no reviewer could see from
 * a diff: adding a nav entry looks correct in isolation, and the page it names
 * is in a different file that may never have been written.
 *
 * Pure — no database, no network. Runs in `quality` on every PR.
 */
import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";
import {
  buildDefaultSidebarModel,
  composeSidebarSections,
  CORE_MODULE_KEY,
  CORE_NAV_ENTRIES,
  DEFAULT_MENU_TYPES,
  DEFAULT_MODULE_TYPE,
  SIDEBAR_LABELS
} from "../src/modules/module-management/domain/sidebar-menu";

/**
 * `/admin/tenant/domains` -> `src/pages/admin/tenant/domains.astro`. Astro also
 * resolves `<path>/index.astro`, so both spellings count as the page existing.
 */
async function adminPagePaths(): Promise<Set<string>> {
  const paths = new Set<string>();

  for await (const file of new Bun.Glob("src/pages/admin/**/*.astro").scan({
    cwd: process.cwd(),
    dot: true
  })) {
    paths.add(
      "/" +
        file
          .replace(/^src\/pages\//, "")
          .replace(/\.astro$/, "")
          .replace(/\/index$/, "")
    );
  }

  return paths;
}

function declaredEntries() {
  return listModules().flatMap((module) =>
    (module.navigation ?? []).map((nav) => ({
      moduleKey: module.key,
      ...nav
    }))
  );
}

describe("admin navigation matches the pages that exist", () => {
  test("every declared navigation path resolves to a real admin page", async () => {
    const pages = await adminPagePaths();
    const entries = declaredEntries();

    // Guard the fixture. An empty glob or an empty registry would pass
    // vacuously, which is exactly how the first version of the module-absence
    // gate scanned zero files while appearing to cover them.
    expect(pages.size).toBeGreaterThan(5);
    expect(entries.length).toBeGreaterThan(3);

    const dangling = entries
      .filter((entry) => !pages.has(entry.path))
      .map(
        (entry) =>
          `${entry.moduleKey} declares navigation to "${entry.path}", which has ` +
          `no page under src/pages/admin/. Remove the entry, or add the screen.`
      );

    expect(dangling.sort()).toEqual([]);
  });

  test("every admin page is claimed by exactly one descriptor or is a core entry", async () => {
    const pages = await adminPagePaths();
    const corePaths = new Set(CORE_NAV_ENTRIES.map((entry) => entry.path));
    const claims = new Map<string, string[]>();

    for (const entry of declaredEntries()) {
      claims.set(entry.path, [
        ...(claims.get(entry.path) ?? []),
        entry.moduleKey
      ]);
    }

    const problems: string[] = [];

    for (const page of pages) {
      const owners = claims.get(page) ?? [];

      if (corePaths.has(page)) {
        if (owners.length > 0) {
          problems.push(
            `"${page}" is a CORE_NAV_ENTRIES item but is also claimed by ${owners.join(", ")}.`
          );
        }
        continue;
      }

      if (owners.length === 0) {
        problems.push(
          `"${page}" exists but no module declares navigation to it, and it is ` +
            `not in CORE_NAV_ENTRIES — it can never appear in the sidebar.`
        );
      }
    }

    // Duplicate claims are separately rejected by `modules:compose:check`;
    // asserted here too because this gate is the one a reader consults.
    for (const [path, owners] of claims) {
      if (owners.length > 1) {
        problems.push(`"${path}" is claimed by ${owners.join(", ")}.`);
      }
    }

    expect(problems.sort()).toEqual([]);
  });
});

describe("the sidebar model is complete and renderable", () => {
  test("every registered module has a default type placement", () => {
    // Without this, a new module's nav silently lands in `general` — a real
    // section, so the mistake renders as a plausible sidebar rather than a gap.
    const unplaced = listModules()
      .map((module) => module.key)
      .filter((key) => !(key in DEFAULT_MODULE_TYPE));

    expect(unplaced.sort()).toEqual([]);
  });

  test("every default type placement names a registered module", () => {
    const registered = new Set(listModules().map((module) => module.key));
    const stale = Object.keys(DEFAULT_MODULE_TYPE).filter(
      (key) => !registered.has(key)
    );

    expect(stale.sort()).toEqual([]);
  });

  test("every placement targets a type in the taxonomy", () => {
    const known = new Set(DEFAULT_MENU_TYPES.map((type) => type.typeKey));
    const unknown = Object.entries(DEFAULT_MODULE_TYPE)
      .filter(([, typeKey]) => !known.has(typeKey))
      .map(([moduleKey, typeKey]) => `${moduleKey} -> "${typeKey}"`);

    expect(unknown.sort()).toEqual([]);
  });

  test("every label key that can be rendered has a label", () => {
    // This base has no gettext catalog, so an unresolved key renders as the raw
    // key. `resolveSidebarLabel` falls back rather than throwing on purpose —
    // a missing label must not break the admin shell — which is precisely why
    // it needs a gate instead of surfacing at runtime.
    const required = new Set<string>([
      ...DEFAULT_MENU_TYPES.map((type) => type.labelKey),
      ...CORE_NAV_ENTRIES.map((entry) => entry.labelKey),
      ...listModules().flatMap((module) =>
        (module.navigation ?? []).map((nav) => nav.labelKey)
      )
    ]);

    const missing = [...required].filter((key) => !(key in SIDEBAR_LABELS));
    const unused = Object.keys(SIDEBAR_LABELS).filter(
      (key) => !required.has(key)
    );

    expect(missing.sort()).toEqual([]);
    // Unused entries are how a removed nav item leaves a label behind that
    // reads as still-supported.
    expect(unused.sort()).toEqual([]);
  });
});

describe("composition filters and orders deterministically", () => {
  const model = buildDefaultSidebarModel(listModules());
  const allPermissions = new Set(
    model.flatMap((entry) =>
      entry.requiredPermission ? [entry.requiredPermission] : []
    )
  );

  test("an owner sees every entry, grouped under known types", () => {
    const sections = composeSidebarSections(model, {
      grantedPermissionKeys: allPermissions,
      tenantDisabledModuleKeys: new Set()
    });
    const rendered = sections.flatMap((section) =>
      section.groups.flatMap((group) => group.entries.map((e) => e.path))
    );

    expect(rendered.sort()).toEqual(model.map((e) => e.path).sort());

    const order = DEFAULT_MENU_TYPES.map((type) => type.typeKey);
    const positions = sections.map((section) => order.indexOf(section.typeKey));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(positions.every((position) => position >= 0)).toBe(true);
  });

  test("a caller with no permissions still sees the ungated core entry", () => {
    const sections = composeSidebarSections(model, {
      grantedPermissionKeys: new Set(),
      tenantDisabledModuleKeys: new Set()
    });
    const rendered = sections.flatMap((section) =>
      section.groups.flatMap((group) => group.entries.map((e) => e.path))
    );

    // Every non-core entry declares a `requiredPermission`, so this is the
    // whole sidebar for an actor holding nothing.
    expect(rendered).toEqual(CORE_NAV_ENTRIES.map((entry) => entry.path));
  });

  test("disabling a module drops its entries but never the core group", () => {
    const sections = composeSidebarSections(model, {
      grantedPermissionKeys: allPermissions,
      tenantDisabledModuleKeys: new Set(["comments", CORE_MODULE_KEY])
    });
    const groups = sections.flatMap((section) => section.groups);

    expect(groups.some((group) => group.moduleKey === "comments")).toBe(false);
    // `CORE_MODULE_KEY` is not a real module and can never be disabled; passing
    // it must not remove the dashboard.
    expect(groups.some((group) => group.moduleKey === CORE_MODULE_KEY)).toBe(
      true
    );
  });

  test("an empty section is dropped rather than rendered as a bare heading", () => {
    const sections = composeSidebarSections(model, {
      grantedPermissionKeys: new Set(),
      tenantDisabledModuleKeys: new Set()
    });

    expect(sections.every((section) => section.groups.length > 0)).toBe(true);
    // `commerce` is carried in the taxonomy for family parity with awcms-micro
    // and no module populates it here — so it must not appear.
    expect(sections.some((section) => section.typeKey === "commerce")).toBe(
      false
    );
  });

  test("only the entry matching the current path is marked current", () => {
    const target = model.find((entry) => entry.moduleKey !== CORE_MODULE_KEY)!;
    const sections = composeSidebarSections(model, {
      grantedPermissionKeys: allPermissions,
      tenantDisabledModuleKeys: new Set(),
      currentPath: target.path
    });
    const current = sections
      .flatMap((section) => section.groups.flatMap((group) => group.entries))
      .filter((entry) => entry.isCurrent)
      .map((entry) => entry.path);

    expect(current).toEqual([target.path]);
  });
});
