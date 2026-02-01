/**
 * Theme system library for dynamic theming from Supabase.
 * Manages theme configuration, CSS variables, and tenant-specific theming.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ThemeConfig {
  id: string;
  name: string;
  slug: string;
  is_default: boolean;
  is_active: boolean;
  colors: ThemeColors;
  typography: ThemeTypography;
  spacing: ThemeSpacing;
  custom_css?: string;
}

export interface ThemeColors {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  foreground: string;
  muted: string;
  border: string;
  error: string;
  success: string;
  warning: string;
}

export interface ThemeTypography {
  font_family: string;
  font_family_heading: string;
  base_size: string;
  line_height: string;
  heading_weight: string;
}

export interface ThemeSpacing {
  container_max_width: string;
  section_padding: string;
  component_radius: string;
}

/**
 * Fetch active theme for a tenant
 */
export async function getActiveTheme(
  supabase: SupabaseClient,
  tenantId?: string | null,
): Promise<ThemeConfig | null> {
  let query = supabase
    .from("themes")
    .select("*")
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (tenantId) {
    query = query.eq("tenant_id", tenantId);
  }

  const { data, error } = await query.single();

  if (error) {
    if (error.code === "PGRST116") return null;
    console.error("[Theme] Error fetching theme:", error.message);
    return null;
  }

  return parseThemeData(data);
}

/**
 * Fetch all themes for a tenant
 */
export async function getAllThemes(
  supabase: SupabaseClient,
  tenantId?: string | null,
): Promise<ThemeConfig[]> {
  let query = supabase
    .from("themes")
    .select("*")
    .is("deleted_at", null)
    .order("name");

  if (tenantId) {
    query = query.eq("tenant_id", tenantId);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[Theme] Error fetching themes:", error.message);
    return [];
  }

  return (data || []).map(parseThemeData);
}

function parseThemeData(data: Record<string, unknown>): ThemeConfig {
  const config =
    typeof data.config === "string"
      ? JSON.parse(data.config)
      : data.config || {};

  return {
    id: data.id as string,
    name: data.name as string,
    slug: data.slug as string,
    is_default: (data.is_default as boolean) || false,
    is_active: (data.is_active as boolean) || false,
    colors: config.colors || getDefaultColors(),
    typography: config.typography || getDefaultTypography(),
    spacing: config.spacing || getDefaultSpacing(),
    custom_css: config.custom_css,
  };
}

/**
 * Generate CSS variables from theme config
 */
export function generateCssVariables(theme: ThemeConfig): string {
  const { colors, typography, spacing } = theme;

  return `:root {
  /* Colors */
  --color-primary: ${colors.primary};
  --color-secondary: ${colors.secondary};
  --color-accent: ${colors.accent};
  --color-background: ${colors.background};
  --color-foreground: ${colors.foreground};
  --color-muted: ${colors.muted};
  --color-border: ${colors.border};
  --color-error: ${colors.error};
  --color-success: ${colors.success};
  --color-warning: ${colors.warning};

  /* Typography */
  --font-family: ${typography.font_family};
  --font-family-heading: ${typography.font_family_heading};
  --font-size-base: ${typography.base_size};
  --line-height: ${typography.line_height};
  --heading-weight: ${typography.heading_weight};

  /* Spacing */
  --container-max-width: ${spacing.container_max_width};
  --section-padding: ${spacing.section_padding};
  --radius: ${spacing.component_radius};
}${theme.custom_css ? `\n\n/* Custom CSS */\n${theme.custom_css}` : ""}`;
}

function getDefaultColors(): ThemeColors {
  return {
    primary: "#3b82f6",
    secondary: "#64748b",
    accent: "#f59e0b",
    background: "#ffffff",
    foreground: "#0f172a",
    muted: "#f1f5f9",
    border: "#e2e8f0",
    error: "#ef4444",
    success: "#22c55e",
    warning: "#eab308",
  };
}

function getDefaultTypography(): ThemeTypography {
  return {
    font_family: "Inter, system-ui, sans-serif",
    font_family_heading: "Inter, system-ui, sans-serif",
    base_size: "16px",
    line_height: "1.6",
    heading_weight: "700",
  };
}

function getDefaultSpacing(): ThemeSpacing {
  return {
    container_max_width: "1280px",
    section_padding: "4rem",
    component_radius: "0.5rem",
  };
}
