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
  area: asString(widget.area, asString(asRecord(widget.template_part)?.slug, "default")),
  area_id: asNullableString(widget.area_id),
  config:
    typeof widget.config === "string" ? JSON.parse(widget.config) : widget.config || {},
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

export async function getWidgetsByArea(
  supabase: SupabaseClient,
  area: string,
  tenantId: string,
): Promise<WidgetData[]> {
  if (!tenantId) return [];

  const { data, error } = await supabase
    .from("widgets")
    .select("*")
    .eq("area", area)
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true });

  if (error) {
    if (error.message?.includes("column widgets.area does not exist")) {
      return [];
    }
    console.error(`[Widget] Error fetching widgets for area "${area}":`, error.message);
    return [];
  }

  return (data || []).map(normalizeWidgetRow);
}

export async function getWidgetsByAreaSlug(
  supabase: SupabaseClient,
  areaSlug: string,
  tenantId: string,
): Promise<WidgetData[]> {
  if (!tenantId) return [];

  const { data: part, error: partError } = await supabase
    .from("template_parts")
    .select("id, slug")
    .eq("slug", areaSlug)
    .eq("type", "widget_area")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();

  if (partError || !part?.id) {
    return [];
  }

  const { data, error } = await supabase
    .from("widgets")
    .select("*, template_part:template_parts(slug)")
    .eq("area_id", part.id)
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("order", { ascending: true });

  if (error) {
    console.error(`[Widget] Error fetching widgets for area slug "${areaSlug}":`, error.message);
    return [];
  }

  return (data || []).map(normalizeWidgetRow);
}
