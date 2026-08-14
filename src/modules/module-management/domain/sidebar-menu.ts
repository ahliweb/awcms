/**
 * The admin sidebar model, derived from the module registry.
 *
 * ## Why this exists
 *
 * `ModuleDescriptor.navigation` was already consumed three ways — validated
 * for path conflicts by `module-composition.ts`, written to
 * `awcms_module_navigation` by `descriptor-sync.ts`, and served by
 * `GET /api/v1/modules` through `navigation-registry.ts` — while
 * `AdminLayout.astro` rendered a hand-maintained array that read none of it.
 *
 * Two sources, never compared, and both had rotted in opposite directions:
 * three declared entries pointed at admin pages that do not exist
 * (`/admin/blog`, two `/admin/news-portal/*`), and eight pages that DO exist
 * were unknown to the registry. The dead entries were being synced to the
 * database and served by the API as valid menu items. `comments/module.ts`
 * spelled the arrangement out honestly — "the sidebar entry is added there by
 * hand. Both must be kept in step until that subsystem exists" — which is a
 * description of drift waiting to happen, not a safeguard.
 *
 * This file is that subsystem's first half: the DEFAULT model, computed from
 * `listModules()`. Ported from awcms-micro's
 * `module-management/domain/sidebar-menu.ts`, minus the per-tenant override
 * layer (its `awcms_sidebar_menu_{types,items}` tables and admin editor are a
 * separate increment — see the module README).
 *
 * ## What this is not
 *
 * **Not authorization.** `requiredPermission` here only decides whether a LINK
 * is drawn. Every target page and API runs its own server-side guard
 * regardless, exactly as `navigation-registry.ts` already documents. A visible
 * link grants nothing and a hidden one protects nothing.
 *
 * The entry set is trusted BUILD-TIME data: the synthetic core items below plus
 * whatever modules declare. Nothing here reads user input, so no entry can be
 * injected at runtime.
 */
import type {
  ModuleDescriptor,
  ModuleLifecycleStatus
} from "../../_shared/module-contract";

/** Synthetic module key for admin items that belong to no module. */
export const CORE_MODULE_KEY = "core";

/** Bucket for any entry whose module is absent from `DEFAULT_MODULE_TYPE` and whose nav entry declares no `group`. */
export const DEFAULT_FALLBACK_TYPE = "general";

/**
 * The ordered type taxonomy. Position here IS the rendered section order.
 *
 * Kept identical to awcms-micro's list so the two admin shells stay
 * structurally comparable — including `commerce`, which no module in this base
 * populates yet. An unpopulated type renders nothing at all (see
 * `composeSidebarSections`), so carrying it costs a line and avoids a family
 * divergence that would have to be justified in
 * `awcms-family-compatibility.yaml`. ADR-0035 puts the e-commerce cluster in
 * scope for this template, so it is a slot that is expected to fill.
 */
export const DEFAULT_MENU_TYPES: readonly {
  typeKey: string;
  labelKey: string;
}[] = [
  { typeKey: "system", labelKey: "admin.menu_type.system" },
  { typeKey: "content", labelKey: "admin.menu_type.content" },
  { typeKey: "commerce", labelKey: "admin.menu_type.commerce" },
  { typeKey: "engagement", labelKey: "admin.menu_type.engagement" },
  { typeKey: "operations", labelKey: "admin.menu_type.operations" },
  { typeKey: "identity", labelKey: "admin.menu_type.identity" },
  { typeKey: "general", labelKey: "admin.menu_type.general" }
];

const DEFAULT_TYPE_INDEX = new Map(
  DEFAULT_MENU_TYPES.map((type, index) => [type.typeKey, index])
);

/**
 * Default type placement per module key, so a module lands in a sensible
 * section without every `module.ts` having to carry a `group`. Covers all 20
 * registered modules; `tests/admin-navigation-registry.test.ts` fails when a
 * module is added without a placement — and, as ADR-0044 proved, also when a
 * RETIRED module keeps its placement. `news_portal` merged into `blog_content`
 * and its line was removed here; the assertion caught it, which is the second
 * direction of the completeness check earning its place.
 *
 * This map WINS over a nav entry's own `group` — the same precedence
 * awcms-micro uses. `comments` previously declared `group: "content"`; that
 * key was removed rather than left to be overridden here, because a field
 * whose value can never take effect is the drift this file exists to remove.
 */
export const DEFAULT_MODULE_TYPE: Readonly<Record<string, string>> = {
  // System / platform administration.
  module_management: "system",
  tenant_admin: "system",
  tenant_domain: "system",
  theming: "system",
  seo_distribution: "system",
  site_search: "system",
  email: "system",
  form_drafts: "system",
  logging: "system",
  // Content authoring & media.
  blog_content: "content",
  media_library: "content",
  // Audience engagement.
  comments: "engagement",
  // Operations / observability. `workflow` (the `workflow-approval` directory)
  // has no counterpart in awcms-micro, so it is absent from the map this was
  // ported from — the completeness assertion in
  // `tests/admin-navigation-registry.test.ts` failed on exactly that the first
  // time it ran, which is the assertion earning its place.
  workflow: "operations",
  reporting: "operations",
  visitor_analytics: "operations",
  sync_storage: "operations",
  data_lifecycle: "operations",
  domain_event_runtime: "operations",
  // ADR-0074. Placed even though the module declares NO navigation yet: this
  // map must cover every registered module, and the placement is what stops its
  // first screen from landing silently in `general` — a real section, so the
  // mistake would render as a plausible sidebar rather than as a gap.
  push_delivery: "operations",
  // Master reference data. This module DOES declare navigation now
  // (`/admin/idn-regions`, landed with ADR-0053/PR #332). The comment that used
  // to sit here said its operator screen lived in awcms-astro per ADR-0047 —
  // wrong ADR (that split was ADR-0048) and a decision since revoked (ADR-0051
  // consolidated every SYSTEM admin screen here; ADR-0047 itself is superseded
  // by ADR-0055). The placement still earns its line: the map must cover every
  // registered module, so the screen lands in `operations` rather than silently
  // in "general".
  idn_admin_regions: "operations",
  // Identity.
  identity_access: "identity",
  profile_identity: "identity"
};

/**
 * Admin items owned by no module.
 *
 * Two entries, where awcms-micro has five. `/admin/access-users`,
 * `/admin/sync` and `/admin/settings` remain pages this base does not have;
 * listing them would put permanent 404s in the sidebar — the exact defect this
 * change removed — so they arrive if and when their pages do.
 *
 * micro's `/admin/profile` DID arrive, as `/admin/account` (ADR-0096). The name
 * differs on purpose: `profile_identity` owns a `Profiles` screen about parties
 * in general, and two sidebar items both called some form of "profile" would be
 * two different things wearing one word.
 *
 * Both entries are ungated on purpose. `/admin/index.astro` renders without
 * `reporting.dashboard.read`, degrading to an empty state instead of a denial,
 * so gating the link would hide a page the user can still open; `/admin/account`
 * carries no permission at all, because its subject is the caller (ADR-0096).
 */
export const CORE_NAV_ENTRIES: readonly {
  path: string;
  labelKey: string;
  order: number;
}[] = [
  { path: "/admin", labelKey: "admin.layout.nav_dashboard", order: 0 },
  // ADR-0096. The comment above named `/admin/profile` as one of the pages this
  // base "does not have … they arrive if and when their pages do". This is that
  // arrival, under the name the screen actually uses.
  //
  // Core rather than `identity_access`, and ungated for the same reason the
  // dashboard is: every signed-in person has an account, the screen carries no
  // `requiredPermission`, and `identity_access`'s own entries (Users, Roles,
  // Invitations) are administrative screens about OTHER people. Filing it there
  // would group it with things it is not, under a heading that implies authority
  // over someone else.
  { path: "/admin/account", labelKey: "admin.layout.nav_account", order: 1 }
];

/**
 * `labelKey` -> the English string actually rendered.
 *
 * Descriptors have always carried `labelKey` — and, for a long time, nothing
 * rendered it. A key with no resolver is how `admin.layout.nav_blog` sat in the
 * registry unnoticed while pointing at a missing page. So: one table, gated for
 * completeness in both directions.
 *
 * ADR-0095 landed the catalog this comment used to anticipate, and it is the
 * SEED that was predicted rather than a thing that had to be unpicked — but note
 * carefully what did NOT happen. The catalog is keyed on the English STRING, not
 * on `labelKey`, so this table is unchanged and `AdminLayout` translates its
 * output (`t(entry.label)`). Two consequences worth stating:
 *
 *   - The values below are `msgid`s. Rewording one silently detaches its
 *     translation, and `i18n:catalog:check` is what makes that visible.
 *   - `tests/i18n-sidebar-labels.test.ts` asserts every value here exists in the
 *     catalogs. That check reads this table rather than call syntax, which is why
 *     `AdminLayout` is exempt from the gate's literal-msgid harvest.
 */
export const SIDEBAR_LABELS: Readonly<Record<string, string>> = {
  "admin.menu_type.system": "System",
  "admin.menu_type.content": "Content",
  "admin.menu_type.commerce": "Commerce",
  "admin.menu_type.engagement": "Engagement",
  "admin.menu_type.operations": "Operations",
  "admin.menu_type.identity": "Identity",
  "admin.menu_type.general": "General",
  "admin.layout.nav_dashboard": "Dashboard",
  "admin.layout.nav_account": "My account",
  "admin.layout.nav_tenants": "Tenants",
  "admin.layout.nav_offices": "Offices",
  "admin.layout.nav_tenant_domains": "Tenant domains",
  "admin.layout.nav_modules": "Modules",
  "admin.layout.nav_sidebar_menu": "Sidebar menu",
  "admin.layout.nav_form_drafts": "Form drafts",
  "admin.layout.nav_site_search": "Site search",
  "admin.layout.nav_theming": "Theming",
  "admin.layout.nav_email_templates": "Email templates",
  "admin.layout.nav_email_suppression": "Email suppression",
  "admin.layout.nav_audit_trail": "Audit trail",
  "admin.layout.nav_comments": "Moderation queue",
  "admin.layout.nav_visitor_analytics": "Visitor analytics",
  "admin.layout.nav_data_lifecycle": "Data lifecycle",
  "admin.layout.nav_subject_requests": "Subject requests",
  "admin.layout.nav_idn_regions": "Region datasets",
  "admin.layout.nav_blog": "Blog posts",
  "admin.layout.nav_blog_pages": "Blog pages",
  "admin.layout.nav_blog_taxonomy": "Blog taxonomy",
  "admin.layout.nav_blog_presentation": "Blog presentation",
  "admin.layout.nav_blog_settings": "Blog settings",
  "admin.layout.nav_media": "Media library",
  "admin.layout.nav_reporting": "Reporting operations",
  "admin.layout.nav_approvals": "Approvals",
  "admin.layout.nav_domain_events": "Domain events",
  "admin.layout.nav_push_notifications": "Push notifications",
  "admin.layout.nav_sync": "Sync & storage",
  "admin.layout.nav_profiles": "Profiles",
  "admin.layout.nav_users": "Users",
  "admin.layout.nav_roles": "Roles",
  "admin.layout.nav_abac_policies": "ABAC policies",
  "admin.layout.nav_user_groups": "User groups",
  "admin.layout.nav_registrations": "Registration requests",
  "admin.layout.nav_security": "Authentication & security",
  "admin.layout.nav_partners": "Partner access",
  "admin.layout.nav_partner_registry": "Partner registry",
  "admin.layout.nav_machine_credentials": "Machine credentials",
  "admin.layout.nav_invitations": "Invitations",
  "admin.layout.nav_business_scope": "Business scope",
  "admin.layout.nav_seo": "SEO & distribution"
};

/** Display name for the synthetic core group. Rendered as a module sub-label. */
export const CORE_GROUP_LABEL = "General";

/** Resolve a label key, falling back to the key itself so a gap is visible rather than blank. */
export function resolveSidebarLabel(labelKey: string): string {
  return SIDEBAR_LABELS[labelKey] ?? labelKey;
}

/** One default (code-derived) entry, before any filtering. */
export type SidebarDefaultEntry = {
  path: string;
  /** Owning module key, or `CORE_MODULE_KEY`. */
  moduleKey: string;
  /** Owning module's display name, or `CORE_GROUP_LABEL`. */
  moduleName: string;
  /** Top-level section this entry lands under. */
  typeKey: string;
  labelKey: string;
  icon?: string;
  order: number;
  /** Exact permission key required to see the link, if any. */
  requiredPermission?: string;
};

export type SidebarComposeOptions = {
  grantedPermissionKeys: ReadonlySet<string>;
  /** Modules the tenant switched off (`awcms_tenant_modules.enabled = false`). Absent = enabled, matching the tenant module lifecycle service. */
  tenantDisabledModuleKeys: ReadonlySet<string>;
  /** Used to mark `aria-current`; compared exactly. */
  currentPath?: string;
};

export type ComposedEntry = {
  path: string;
  label: string;
  icon?: string;
  isCurrent: boolean;
};

export type ComposedModuleGroup = {
  moduleKey: string;
  /** `null` for the core group — rendered without a module sub-label. */
  moduleLabel: string | null;
  entries: ComposedEntry[];
};

export type ComposedType = {
  typeKey: string;
  label: string;
  groups: ComposedModuleGroup[];
};

/**
 * Build the default model from the registry: the synthetic core items, then
 * every non-`disabled` module's declared navigation.
 *
 * Only the global `disabled` lifecycle status drops a module here — the same
 * rule `filterVisibleNavigationEntries` applies. The tenant-level toggle is a
 * per-request concern and belongs to `composeSidebarSections`.
 */
export function buildDefaultSidebarModel(
  modules: readonly ModuleDescriptor[]
): SidebarDefaultEntry[] {
  const disabled: ModuleLifecycleStatus = "disabled";
  const entries: SidebarDefaultEntry[] = CORE_NAV_ENTRIES.map((core) => ({
    path: core.path,
    moduleKey: CORE_MODULE_KEY,
    moduleName: CORE_GROUP_LABEL,
    typeKey: "system",
    labelKey: core.labelKey,
    order: core.order
  }));

  for (const descriptor of modules) {
    if (descriptor.status === disabled) {
      continue;
    }

    for (const nav of descriptor.navigation ?? []) {
      entries.push({
        path: nav.path,
        moduleKey: descriptor.key,
        moduleName: descriptor.name,
        typeKey:
          DEFAULT_MODULE_TYPE[descriptor.key] ??
          nav.group ??
          DEFAULT_FALLBACK_TYPE,
        labelKey: nav.labelKey,
        icon: nav.icon,
        order: nav.order ?? 0,
        requiredPermission: nav.requiredPermission
      });
    }
  }

  return entries;
}

/** Types not in the taxonomy sort after it, alphabetically — deterministic without needing an edit here. */
function typeRank(typeKey: string): number {
  return DEFAULT_TYPE_INDEX.get(typeKey) ?? DEFAULT_MENU_TYPES.length;
}

/**
 * Filter the default model for one caller and group it into
 * type -> module -> entries.
 *
 * Dropped: entries whose module the tenant disabled (core is never
 * tenant-disabled) and entries whose `requiredPermission` the caller lacks.
 * Types and module groups left with no entries are dropped entirely, so an
 * empty section never renders as a bare heading.
 *
 * Ordering is total and stable: type by taxonomy position, module group by its
 * lowest entry `order`, entries by `order` then `path`. Two modules can never
 * claim the same path (`module-composition.ts` rejects that), so the path tie-
 * break is a determinism belt rather than a real contest.
 */
export function composeSidebarSections(
  defaultEntries: readonly SidebarDefaultEntry[],
  options: SidebarComposeOptions
): ComposedType[] {
  const visible = defaultEntries.filter((entry) => {
    if (
      entry.moduleKey !== CORE_MODULE_KEY &&
      options.tenantDisabledModuleKeys.has(entry.moduleKey)
    ) {
      return false;
    }

    return (
      !entry.requiredPermission ||
      options.grantedPermissionKeys.has(entry.requiredPermission)
    );
  });

  const byType = new Map<string, Map<string, SidebarDefaultEntry[]>>();

  for (const entry of visible) {
    let groups = byType.get(entry.typeKey);

    if (!groups) {
      groups = new Map();
      byType.set(entry.typeKey, groups);
    }

    const bucket = groups.get(entry.moduleKey);

    if (bucket) {
      bucket.push(entry);
    } else {
      groups.set(entry.moduleKey, [entry]);
    }
  }

  const composed: ComposedType[] = [];

  for (const [typeKey, groups] of byType) {
    const ranked: { rank: number; group: ComposedModuleGroup }[] = [];

    for (const [moduleKey, bucket] of groups) {
      const sorted = [...bucket].sort(
        (a, b) => a.order - b.order || a.path.localeCompare(b.path)
      );

      ranked.push({
        // The group's own position is its earliest entry — already at index 0
        // after the sort above.
        rank: sorted[0]?.order ?? 0,
        group: {
          moduleKey,
          moduleLabel:
            moduleKey === CORE_MODULE_KEY
              ? null
              : (sorted[0]?.moduleName ?? null),
          entries: sorted.map((entry) => ({
            path: entry.path,
            label: resolveSidebarLabel(entry.labelKey),
            icon: entry.icon,
            isCurrent: entry.path === options.currentPath
          }))
        }
      });
    }

    ranked.sort(
      (a, b) =>
        a.rank - b.rank || a.group.moduleKey.localeCompare(b.group.moduleKey)
    );

    composed.push({
      typeKey,
      label: resolveSidebarLabel(
        DEFAULT_MENU_TYPES.find((type) => type.typeKey === typeKey)?.labelKey ??
          typeKey
      ),
      groups: ranked.map((entry) => entry.group)
    });
  }

  return composed.sort(
    (a, b) =>
      typeRank(a.typeKey) - typeRank(b.typeKey) ||
      a.typeKey.localeCompare(b.typeKey)
  );
}

/* ===========================================================================
 * Per-tenant override layer (Issue #260)
 * ===========================================================================
 *
 * Everything above computes the DEFAULT model from the registry. What follows
 * lets a tenant reorder, hide, relabel and re-bucket that default, and add
 * custom sections.
 *
 * The security boundary is the same one this file opens with, and it is why
 * overrides are stored as a delta rather than a snapshot: the ITEM SET stays
 * trusted build-time data. A tenant can only override an entry that
 * `buildDefaultSidebarModel` already produced — `applySidebarOverrides` looks
 * every override up BY KEY against the default model and ignores anything that
 * does not match. There is no code path that turns a stored row into a new
 * link, so a malicious or corrupted write cannot inject one.
 */

/** Bounds mirrored by `sql/071`'s CHECK constraints — validated before a write reaches the database. */
export const MAX_TYPE_KEY_LENGTH = 64;
export const MAX_ENTRY_KEY_LENGTH = 256;
export const MAX_LABEL_OVERRIDE_LENGTH = 120;

/**
 * Coarse ceiling on how many rows one save may submit. Defence against a
 * pathological payload, not a product limit: the default model is about a dozen
 * entries, so anything near this is already not a sidebar.
 */
export const MAX_SIDEBAR_ROWS = 500;

/**
 * A custom type key: lowercase slug only. Narrow so a custom key can never
 * collide structurally with a code type, and can never smuggle markup into a
 * rendered section heading.
 */
const TYPE_KEY_PATTERN = /^[a-z0-9_]+$/;

export type SidebarTypeOverride = {
  typeKey: string;
  labelOverride: string | null;
  position: number;
  hidden: boolean;
};

export type SidebarItemOverride = {
  entryKey: string;
  /** The type this item is placed under; `null` keeps its code default. */
  typeKey: string | null;
  position: number;
  labelOverride: string | null;
  hidden: boolean;
};

export type SidebarArrangement = {
  types: SidebarTypeOverride[];
  items: SidebarItemOverride[];
};

export type SidebarValidationIssue = { field: string; message: string };

/**
 * Validate a submitted arrangement before it reaches the database.
 *
 * The CHECK constraints in `sql/071` are the floor; this layer can say WHICH
 * field is wrong. It also enforces two things SQL cannot express as cheaply:
 * intra-payload duplicate keys — the save path is a full DELETE-then-INSERT
 * replace, so a duplicate would otherwise trip a unique violation
 * mid-transaction and surface as a server error — and the total row ceiling.
 */
export function validateSidebarArrangement(
  input: SidebarArrangement
): SidebarValidationIssue[] {
  const issues: SidebarValidationIssue[] = [];

  if (input.types.length + input.items.length > MAX_SIDEBAR_ROWS) {
    issues.push({
      field: "arrangement",
      message: `At most ${MAX_SIDEBAR_ROWS} rows may be submitted in one save.`
    });
  }

  const seenTypes = new Set<string>();

  for (const [index, type] of input.types.entries()) {
    if (!TYPE_KEY_PATTERN.test(type.typeKey)) {
      issues.push({
        field: `types[${index}].typeKey`,
        message:
          "Type key must be a lowercase slug (letters, digits, underscore)."
      });
    }

    if (type.typeKey.length > MAX_TYPE_KEY_LENGTH) {
      issues.push({
        field: `types[${index}].typeKey`,
        message: `Type key must be at most ${MAX_TYPE_KEY_LENGTH} characters.`
      });
    }

    if (
      type.labelOverride !== null &&
      type.labelOverride.length > MAX_LABEL_OVERRIDE_LENGTH
    ) {
      issues.push({
        field: `types[${index}].labelOverride`,
        message: `Label must be at most ${MAX_LABEL_OVERRIDE_LENGTH} characters.`
      });
    }

    if (seenTypes.has(type.typeKey)) {
      issues.push({
        field: `types[${index}].typeKey`,
        message: `Duplicate type key "${type.typeKey}" in this payload.`
      });
    }

    seenTypes.add(type.typeKey);
  }

  const seenEntries = new Set<string>();

  for (const [index, item] of input.items.entries()) {
    if (item.entryKey === "" || item.entryKey.length > MAX_ENTRY_KEY_LENGTH) {
      issues.push({
        field: `items[${index}].entryKey`,
        message: `Entry key must be 1-${MAX_ENTRY_KEY_LENGTH} characters.`
      });
    }

    if (item.typeKey !== null && !TYPE_KEY_PATTERN.test(item.typeKey)) {
      issues.push({
        field: `items[${index}].typeKey`,
        message:
          "Type key must be a lowercase slug (letters, digits, underscore)."
      });
    }

    if (
      item.labelOverride !== null &&
      item.labelOverride.length > MAX_LABEL_OVERRIDE_LENGTH
    ) {
      issues.push({
        field: `items[${index}].labelOverride`,
        message: `Label must be at most ${MAX_LABEL_OVERRIDE_LENGTH} characters.`
      });
    }

    if (seenEntries.has(item.entryKey)) {
      issues.push({
        field: `items[${index}].entryKey`,
        message: `Duplicate entry key "${item.entryKey}" in this payload.`
      });
    }

    seenEntries.add(item.entryKey);
  }

  return issues;
}

/**
 * Apply a tenant's overrides on top of the default model.
 *
 * Returns a NEW default-entry list, so the existing `composeSidebarSections`
 * does the grouping, permission filtering and ordering unchanged — the override
 * layer changes what entries SAY, never how they are assembled or who may see
 * them.
 *
 * An override whose `entryKey` matches no default entry is IGNORED. That is the
 * injection boundary: the item set is build-time data, and a stored row can
 * only ever modify an entry the registry already produced.
 *
 * A hidden entry is dropped here rather than flagged, because
 * `composeSidebarSections` already drops empty groups and empty types — so
 * hiding the last item in a section removes the section too, with no extra
 * rule.
 */
export function applySidebarOverrides(
  defaultEntries: readonly SidebarDefaultEntry[],
  arrangement: SidebarArrangement
): SidebarDefaultEntry[] {
  const itemByKey = new Map(
    arrangement.items.map((item) => [item.entryKey, item])
  );
  const hiddenTypes = new Set(
    arrangement.types.filter((type) => type.hidden).map((type) => type.typeKey)
  );

  const applied: SidebarDefaultEntry[] = [];

  for (const entry of defaultEntries) {
    const override = itemByKey.get(entry.path);

    if (override?.hidden) {
      continue;
    }

    const typeKey = override?.typeKey ?? entry.typeKey;

    if (hiddenTypes.has(typeKey)) {
      continue;
    }

    applied.push({
      ...entry,
      typeKey,
      order: override ? override.position : entry.order,
      // A label override replaces the resolved label, carried as a pre-resolved
      // string through `labelKey` — `resolveSidebarLabel` falls back to the key
      // itself when it is not in the catalog, which is exactly what is wanted.
      labelKey: override?.labelOverride ?? entry.labelKey
    });
  }

  return applied;
}

/**
 * Section ordering and labelling after overrides.
 *
 * Separate from `applySidebarOverrides` because it operates on the COMPOSED
 * result: a type's position and label belong to the section, not to any entry,
 * so they cannot be folded into the entry list.
 */
export function applySidebarTypeOverrides(
  sections: readonly ComposedType[],
  arrangement: SidebarArrangement
): ComposedType[] {
  const byKey = new Map(
    arrangement.types.map((type) => [type.typeKey, type] as const)
  );

  return [...sections]
    .map((section) => {
      const override = byKey.get(section.typeKey);

      return {
        ...section,
        label: override?.labelOverride ?? section.label
      };
    })
    .sort((a, b) => {
      // A type with no override keeps its taxonomy position, expressed on the
      // same scale so overridden and default sections interleave predictably
      // instead of the overridden ones all jumping to the front.
      const aRank = byKey.get(a.typeKey)?.position ?? typeRank(a.typeKey);
      const bRank = byKey.get(b.typeKey)?.position ?? typeRank(b.typeKey);

      return aRank - bRank || a.typeKey.localeCompare(b.typeKey);
    });
}
