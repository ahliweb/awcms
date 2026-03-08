/**
 * Menu fetching utilities for dynamic navigation from Supabase.
 * Syncs with MenusManager in admin panel for unified menu management.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const isMissingLocaleColumnError = (message: string): boolean =>
  message.includes(".locale") && message.includes("does not exist");

export interface MenuItem {
  id: string;
  title: string;
  url: string | null;
  icon?: string | null;
  children?: MenuItem[];
  is_active: boolean;
  is_public: boolean;
  role_id?: string | null;
  sort_order: number;
}

export interface HeaderLink {
  text?: string;
  href?: string;
  ariaLabel?: string;
  icon?: string;
  links?: HeaderLink[];
}

interface MenuRow {
  id: string;
  label: string;
  url: string | null;
  icon?: string | null;
  order?: number | null;
  parent_id?: string | null;
  is_active?: boolean | null;
  is_public?: boolean | null;
  role_id?: string | null;
  location?: string | null;
  group_label?: string | null;
}

interface MenuLocationOptions {
  tenantId?: string | null;
  locale?: string;
  roleIds?: string[];
  includeRestricted?: boolean;
}

/**
 * Fetch menu by location (header, footer, sidebar, etc.)
 */
export async function getMenuByLocation(
  supabase: SupabaseClient,
  location: string,
  tenantIdOrOptions?: string | null | MenuLocationOptions,
  localeArg?: string,
  roleIdsArg?: string[],
): Promise<MenuItem[] | null> {
  const options: MenuLocationOptions =
    typeof tenantIdOrOptions === "object" && tenantIdOrOptions !== null
      ? tenantIdOrOptions
      : {
          tenantId: tenantIdOrOptions,
          locale: localeArg,
          roleIds: roleIdsArg,
        };
  const {
    tenantId,
    locale,
    roleIds = [],
    includeRestricted = roleIds.length > 0,
  } = options;

  const runQuery = async (withLocale: boolean) => {
    let query = supabase
      .from("menus")
      .select("*")
      .eq("is_active", true)
      .is("deleted_at", null)
      .or(`location.eq.${location},group_label.eq.${location}`)
      .order("order", { ascending: true });

    if (tenantId) {
      query = query.eq("tenant_id", tenantId);
    }

    if (withLocale && locale) {
      query = query.eq("locale", locale);
    }

    return query;
  };

  const localeFilterEnabled = Boolean(locale);
  let { data, error } = await runQuery(localeFilterEnabled);

  if (
    error &&
    localeFilterEnabled &&
    isMissingLocaleColumnError(error.message || "")
  ) {
    ({ data, error } = await runQuery(false));
  }

  if (error) {
    console.error(
      `[Menu] Error fetching menu for location "${location}":`,
      error.message,
    );
    return null;
  }

  if (!data || data.length === 0) {
    return null;
  }

  const rows = (data || []) as MenuRow[];
  const publicRows = rows.filter((row) => row.is_public !== false);

  const allowedMenuIds = new Set<string>();
  if (includeRestricted && roleIds.length > 0) {
    const directRoleMatches = rows
      .filter((row) => row.role_id && roleIds.includes(row.role_id))
      .map((row) => row.id);

    if (directRoleMatches.length > 0) {
      directRoleMatches.forEach((id) => allowedMenuIds.add(id));
    }

    const { data: permissionRows, error: permissionsError } = await supabase
      .from("menu_permissions")
      .select("menu_id, role_id, can_view")
      .in("role_id", roleIds)
      .eq("can_view", true)
      .in(
        "menu_id",
        rows.map((row) => row.id),
      );

    if (permissionsError) {
      console.error(
        `[Menu] Error fetching menu permissions for location "${location}":`,
        permissionsError.message,
      );
    } else {
      (permissionRows || []).forEach((permission) => {
        if (permission.menu_id) {
          allowedMenuIds.add(permission.menu_id);
        }
      });
    }
  }

  const scopedRows = rows.filter((row) => {
    if (row.is_public !== false) return true;
    if (!includeRestricted) return false;
    return allowedMenuIds.has(row.id);
  });

  const items = buildMenuTree(scopedRows.length > 0 ? scopedRows : publicRows);
  return filterActiveItems(items);
}

/**
 * Fetch all menus for a tenant
 */
export async function getAllMenus(
  supabase: SupabaseClient,
  tenantId?: string | null,
): Promise<Record<string, MenuItem[]>> {
  let query = supabase
    .from("menus")
    .select("*")
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("location")
    .order("order", { ascending: true });

  if (tenantId) {
    query = query.eq("tenant_id", tenantId);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[Menu] Error fetching all menus:", error.message);
    return {};
  }

  const grouped: Record<string, MenuRow[]> = {};
  (data || []).forEach((row) => {
    const location = row.location || row.group_label || "header";
    grouped[location] = grouped[location] || [];
    grouped[location].push(row as MenuRow);
  });

  return Object.entries(grouped).reduce(
    (acc, [location, rows]) => {
      acc[location] = filterActiveItems(
        buildMenuTree(rows.filter((row) => row.is_public !== false)),
      );
      return acc;
    },
    {} as Record<string, MenuItem[]>,
  );
}

/**
 * Get menu items for header navigation
 */
export async function getHeaderMenu(
  supabase: SupabaseClient,
  tenantId?: string | null,
  locale?: string,
): Promise<MenuItem[]> {
  const menu = await getMenuByLocation(supabase, "header", tenantId, locale);
  return menu || [];
}

/**
 * Get menu items for footer navigation
 */
export async function getFooterMenu(
  supabase: SupabaseClient,
  tenantId?: string | null,
  locale?: string,
): Promise<MenuItem[]> {
  const menu = await getMenuByLocation(supabase, "footer", tenantId, locale);
  return menu || [];
}

/**
 * Recursively filter and sort active menu items
 */
function filterActiveItems(items: MenuItem[]): MenuItem[] {
  return items
    .filter((item) => item.is_active !== false)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    .map((item) => ({
      ...item,
      children: item.children ? filterActiveItems(item.children) : undefined,
    }));
}

function buildMenuTree(rows: MenuRow[]): MenuItem[] {
  const nodes: Record<string, MenuItem> = {};
  const roots: MenuItem[] = [];

  rows.forEach((row) => {
    nodes[row.id] = {
      id: row.id,
      title: row.label,
      url: row.url ?? null,
      icon: row.icon ?? null,
      is_active: row.is_active !== false,
      is_public: row.is_public !== false,
      role_id: row.role_id ?? null,
      sort_order: row.order ?? 0,
      children: [],
    };
  });

  rows.forEach((row) => {
    const node = nodes[row.id];
    if (row.parent_id && nodes[row.parent_id]) {
      nodes[row.parent_id].children?.push(node);
    } else {
      roots.push(node);
    }
  });

  roots.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  Object.values(nodes).forEach((node) => {
    if (node.children) {
      node.children.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    }
  });

  return roots;
}

export function mapMenuItemsToHeaderLinks(items: MenuItem[]): HeaderLink[] {
  return items.map((item) => ({
    text: item.title,
    href: item.url || "#",
    links: item.children?.map((child) => ({
      text: child.title,
      href: child.url || "#",
      links: child.children?.map((grandchild) => ({
        text: grandchild.title,
        href: grandchild.url || "#",
      })),
    })),
  }));
}

export function mapMenuItemsToFooterLinks(items: MenuItem[]) {
  return items.map((item) => ({
    title: item.title,
    links: (item.children || []).map((child) => ({
      text: child.title,
      href: child.url || "#",
    })),
  }));
}

/**
 * Build flat list of all URLs for sitemap generation
 */
export function extractMenuUrls(items: MenuItem[]): string[] {
  const urls: string[] = [];

  function traverse(items: MenuItem[]) {
    for (const item of items) {
      if (
        item.url &&
        !item.url.startsWith("#") &&
        !item.url.startsWith("http")
      ) {
        urls.push(item.url);
      }
      if (item.children) {
        traverse(item.children);
      }
    }
  }

  traverse(items);
  return urls;
}
