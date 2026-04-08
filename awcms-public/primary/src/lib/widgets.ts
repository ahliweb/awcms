/**
 * Widget fetching and rendering utilities for dynamic widgets from Supabase.
 * Syncs with WidgetsManager in admin panel for unified widget management.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface WidgetData {
  id: string;
  name: string;
  type: string;
  area: string;
  area_id?: string | null;
  config: Record<string, unknown>;
  content?: string;
  sort_order: number;
  is_active: boolean;
  show_title: boolean;
  custom_classes?: string;
  raw_emdash_payload?: Record<string, unknown> | null;
  source_system?: string | null;
  source_version?: string | null;
  normalization_status?: string | null;
}

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const asNullableString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const asBoolean = (value: unknown, fallback = false): boolean =>
  typeof value === "boolean" ? value : fallback;

const asNumber = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const normalizeWidgetRow = (widget: Record<string, unknown>): WidgetData => ({
  id: asString(widget.id),
  name: asString(widget.name, asString(widget.type, "Widget")),
  type: asString(widget.type),
  area: asString(
    widget.area,
    asString(asRecord(widget.template_part)?.slug, "default"),
  ),
  area_id: asNullableString(widget.area_id),
  config:
    typeof widget.config === "string"
      ? JSON.parse(widget.config)
      : widget.config || {},
  content: asNullableString(widget.content) || undefined,
  sort_order: asNumber(widget.sort_order, asNumber(widget.order, 0)),
  is_active: asBoolean(widget.is_active, true),
  show_title: asBoolean(widget.show_title, true),
  custom_classes: asNullableString(widget.custom_classes) || undefined,
  raw_emdash_payload:
    typeof widget.raw_emdash_payload === "string"
      ? JSON.parse(widget.raw_emdash_payload)
      : widget.raw_emdash_payload || null,
  source_system: asNullableString(widget.source_system),
  source_version: asNullableString(widget.source_version),
  normalization_status: asNullableString(widget.normalization_status),
});

/**
 * Fetch widgets by area (sidebar, footer-1, footer-2, etc.)
 */
export async function getWidgetsByArea(
  supabase: SupabaseClient,
  area: string,
  tenantId?: string | null,
): Promise<WidgetData[]> {
  let query = supabase
    .from("widgets")
    .select("*")
    .eq("area", area)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true });

  if (tenantId) {
    query = query.eq("tenant_id", tenantId);
  }

  const { data, error } = await query;

  if (error) {
    console.error(
      `[Widget] Error fetching widgets for area "${area}":`,
      error.message,
    );
    return [];
  }

  return (data || []).map(normalizeWidgetRow);
}

export async function getWidgetsByAreaSlug(
  supabase: SupabaseClient,
  areaSlug: string,
  tenantId?: string | null,
): Promise<WidgetData[]> {
  let partQuery = supabase
    .from("template_parts")
    .select("id, slug")
    .eq("slug", areaSlug)
    .eq("type", "widget_area")
    .is("deleted_at", null)
    .limit(1);

  if (tenantId) {
    partQuery = partQuery.eq("tenant_id", tenantId);
  }

  const { data: part, error: partError } = await partQuery.maybeSingle();
  if (partError || !part?.id) {
    return [];
  }

  let widgetQuery = supabase
    .from("widgets")
    .select("*, template_part:template_parts(slug)")
    .eq("area_id", part.id)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("order", { ascending: true });

  if (tenantId) {
    widgetQuery = widgetQuery.eq("tenant_id", tenantId);
  }

  const { data, error } = await widgetQuery;
  if (error) {
    console.error(
      `[Widget] Error fetching widgets for area slug "${areaSlug}":`,
      error.message,
    );
    return [];
  }

  return (data || []).map(normalizeWidgetRow);
}

/**
 * Fetch all active widgets for a tenant grouped by area
 */
export async function getAllWidgetsByArea(
  supabase: SupabaseClient,
  tenantId?: string | null,
): Promise<Record<string, WidgetData[]>> {
  let query = supabase
    .from("widgets")
    .select("*")
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("area")
    .order("sort_order", { ascending: true });

  if (tenantId) {
    query = query.eq("tenant_id", tenantId);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[Widget] Error fetching all widgets:", error.message);
    return {};
  }

  const grouped: Record<string, WidgetData[]> = {};

  for (const widget of data || []) {
    const area = widget.area || "default";
    if (!grouped[area]) {
      grouped[area] = [];
    }
    grouped[area].push(normalizeWidgetRow(widget));
  }

  return grouped;
}

/**
 * Fetch widgets for sidebar area
 */
export async function getSidebarWidgets(
  supabase: SupabaseClient,
  tenantId?: string | null,
): Promise<WidgetData[]> {
  return getWidgetsByArea(supabase, "sidebar", tenantId);
}

/**
 * Fetch footer widgets for a specific column
 */
export async function getFooterWidgets(
  supabase: SupabaseClient,
  column: number | string,
  tenantId?: string | null,
): Promise<WidgetData[]> {
  const area = typeof column === "number" ? `footer-${column}` : column;
  return getWidgetsByArea(supabase, area, tenantId);
}
