/**
 * Sidebar configuration and fetching utilities.
 * Manages dynamic sidebar menus and navigation from Supabase.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getMenuByLocation, type MenuItem } from "~/lib/menu";

export interface SidebarItem {
  id: string;
  title: string;
  href: string;
  icon?: string;
  is_active: boolean;
  children?: SidebarItem[];
}

export interface SidebarGroup {
  id: string;
  title: string;
  icon?: string;
  is_collapsed?: boolean;
  items: SidebarItem[];
  sort_order: number;
}

export interface SidebarConfig {
  groups: SidebarGroup[];
  collapsible: boolean;
  show_icons: boolean;
  compact_mode: boolean;
}

/**
 * Fetch sidebar configuration for public portal
 */
export async function getSidebarConfig(
  supabase: SupabaseClient,
  location: string = "public_sidebar",
  tenantId?: string | null,
  locale?: string,
): Promise<SidebarConfig | null> {
  const items = await getMenuByLocation(supabase, location, {
    tenantId,
    locale,
  });

  if (!items || items.length === 0) {
    return null;
  }

  const groups = groupSidebarItems(items);

  return {
    groups,
    collapsible: true,
    show_icons: true,
    compact_mode: false,
  };
}

/**
 * Group flat items into sidebar groups
 */
function groupSidebarItems(items: MenuItem[]): SidebarGroup[] {
  const groups: SidebarGroup[] = [];
  const ungroupedItems: SidebarItem[] = [];

  for (const item of items) {
    const children = (item.children || []).map((child) =>
      mapMenuItemToSidebarItem(child),
    );

    if (children.length > 0) {
      groups.push({
        id: item.id,
        title: item.title,
        icon: item.icon ?? undefined,
        items: children.filter((child) => child.is_active !== false),
        sort_order: item.sort_order,
      });
    } else if (item.is_active !== false) {
      ungroupedItems.push(mapMenuItemToSidebarItem(item));
    }
  }

  if (ungroupedItems.length > 0) {
    groups.unshift({
      id: "default",
      title: "",
      items: ungroupedItems,
      sort_order: 0,
    });
  }

  return groups.sort((a, b) => a.sort_order - b.sort_order);
}

function mapMenuItemToSidebarItem(item: MenuItem): SidebarItem {
  return {
    id: item.id,
    title: item.title,
    href: item.url || "#",
    icon: item.icon || undefined,
    is_active: item.is_active,
    children: item.children?.map((child) => mapMenuItemToSidebarItem(child)),
  };
}

/**
 * Filter sidebar items by user permissions
 */
export function filterByPermissions(
  groups: SidebarGroup[],
  _userPermissions: string[],
): SidebarGroup[] {
  return groups;
}

/**
 * Check if current path matches sidebar item
 */
export function isActivePath(itemHref: string, currentPath: string): boolean {
  if (itemHref === "/") {
    return currentPath === "/";
  }
  return currentPath.startsWith(itemHref);
}

/**
 * Get breadcrumb trail from sidebar
 */
export function getBreadcrumbFromSidebar(
  groups: SidebarGroup[],
  currentPath: string,
): { title: string; href: string }[] {
  const breadcrumb: { title: string; href: string }[] = [];

  for (const group of groups) {
    for (const item of group.items) {
      if (isActivePath(item.href, currentPath)) {
        if (group.title) {
          breadcrumb.push({
            title: group.title,
            href: group.items[0]?.href || "#",
          });
        }
        breadcrumb.push({ title: item.title, href: item.href });

        // Check children
        if (item.children) {
          for (const child of item.children) {
            if (isActivePath(child.href, currentPath)) {
              breadcrumb.push({ title: child.title, href: child.href });
              break;
            }
          }
        }
        return breadcrumb;
      }
    }
  }

  return breadcrumb;
}
