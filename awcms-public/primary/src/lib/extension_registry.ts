import type { SupabaseClient } from "@supabase/supabase-js";

export interface ExtensionPermission {
  key: string;
  description?: string | null;
}

export interface ExtensionManifest {
  schemaVersion: number;
  slug: string;
  name: string;
  vendor: string;
  version: string;
  kind: "bundled" | "external";
  scope: "platform" | "tenant";
  compatibility: { awcms?: string };
  capabilities: string[];
  resources: Record<string, Record<string, unknown>>;
  permissions: ExtensionPermission[];
  adminRoutes: Array<Record<string, unknown>>;
  menus: Array<Record<string, unknown>>;
  publicModules: Array<{
    key: string;
    label: string;
    url: string;
    icon?: string | null;
    order?: number;
    permission?: string | null;
  }>;
  settingsSchema: Record<string, unknown>;
  edgeRoutes: Array<Record<string, unknown>>;
  dependencies: Record<string, string>;
  widgets: Array<Record<string, unknown>>;
  hooks: Record<string, unknown>;
}

export interface TenantExtensionRecord {
  id: string;
  tenant_id: string;
  catalog_id: string;
  activation_state: string;
  installed_version: string;
  config: Record<string, unknown>;
  manifest: ExtensionManifest;
  publicModules: ExtensionManifest["publicModules"];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const normalizeManifest = (input: unknown): ExtensionManifest | null => {
  if (!isObject(input)) return null;
  if (input.schemaVersion !== 1) return null;
  if (
    typeof input.slug !== "string" ||
    typeof input.name !== "string" ||
    typeof input.vendor !== "string"
  )
    return null;

  const permissions = Array.isArray(input.permissions)
    ? (input.permissions
        .map((permission) => {
          if (typeof permission === "string") {
            return { key: permission, description: null };
          }
          if (isObject(permission) && typeof permission.key === "string") {
            return {
              key: permission.key,
              description:
                typeof permission.description === "string"
                  ? permission.description
                  : null,
            };
          }
          return null;
        })
        .filter(Boolean) as ExtensionPermission[])
    : [];

  const publicModules = Array.isArray(input.publicModules)
    ? input.publicModules.filter(
        (
          moduleEntry,
        ): moduleEntry is ExtensionManifest["publicModules"][number] =>
          isObject(moduleEntry) &&
          typeof moduleEntry.key === "string" &&
          typeof moduleEntry.label === "string" &&
          typeof moduleEntry.url === "string",
      )
    : [];

  return {
    schemaVersion: 1,
    slug: input.slug,
    name: input.name,
    vendor: input.vendor,
    version: typeof input.version === "string" ? input.version : "1.0.0",
    kind: input.kind === "bundled" ? "bundled" : "external",
    scope: input.scope === "platform" ? "platform" : "tenant",
    compatibility: isObject(input.compatibility)
      ? (input.compatibility as { awcms?: string })
      : {},
    capabilities: Array.isArray(input.capabilities)
      ? input.capabilities.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
    resources: isObject(input.resources)
      ? (input.resources as Record<string, Record<string, unknown>>)
      : {},
    permissions,
    adminRoutes: Array.isArray(input.adminRoutes) ? input.adminRoutes : [],
    menus: Array.isArray(input.menus) ? input.menus : [],
    publicModules,
    settingsSchema: isObject(input.settingsSchema) ? input.settingsSchema : {},
    edgeRoutes: Array.isArray(input.edgeRoutes) ? input.edgeRoutes : [],
    dependencies: isObject(input.dependencies)
      ? (Object.fromEntries(
          Object.entries(input.dependencies).filter(
            ([, value]) => typeof value === "string",
          ),
        ) as Record<string, string>)
      : {},
    widgets: Array.isArray(input.widgets) ? input.widgets : [],
    hooks: isObject(input.hooks) ? input.hooks : {},
  };
};

export async function getActiveTenantExtensions(
  supabase: SupabaseClient,
  tenantId?: string | null,
): Promise<TenantExtensionRecord[]> {
  let query = supabase
    .from("tenant_extensions")
    .select(
      `id, tenant_id, catalog_id, activation_state, installed_version, config, catalog:platform_extension_catalog(manifest)`,
    )
    .eq("activation_state", "active")
    .is("deleted_at", null);

  if (tenantId) {
    query = query.eq("tenant_id", tenantId);
  }

  const { data, error } = await query;
  if (error) {
    return [];
  }

  return (data || [])
    .map((row) => {
      const catalog = Array.isArray(row.catalog) ? row.catalog[0] : row.catalog;
      const manifest = normalizeManifest(catalog?.manifest);
      if (!manifest) return null;
      return {
        id: row.id,
        tenant_id: row.tenant_id,
        catalog_id: row.catalog_id,
        activation_state: row.activation_state,
        installed_version: row.installed_version,
        config: isObject(row.config) ? row.config : {},
        manifest,
        publicModules: manifest.publicModules,
      };
    })
    .filter(Boolean) as TenantExtensionRecord[];
}

export async function getActivePublicModules(
  supabase: SupabaseClient,
  tenantId?: string | null,
) {
  const edgeUrl =
    import.meta.env.PUBLIC_EDGE_URL || import.meta.env.VITE_EDGE_URL || "";

  if (edgeUrl && tenantId) {
    try {
      const url = new URL(`${edgeUrl}/functions/v1/extensions/public-modules`);
      url.searchParams.set("tenantId", tenantId);
      const response = await fetch(url.toString());
      if (response.ok) {
        const payload = await response.json();
        return Array.isArray(payload?.modules) ? payload.modules : [];
      }
    } catch {
      // Fall back to direct Supabase query when edge fetch is unavailable.
    }
  }

  const extensions = await getActiveTenantExtensions(supabase, tenantId);
  return extensions.flatMap((extension) => extension.publicModules);
}
