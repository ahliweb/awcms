import { supabase } from '@/lib/customSupabaseClient';
import { normalizeCatalogManifest, validateExtensionManifest } from '@/lib/extensionManifest';

const CATALOG_SELECT = `
  id,
  tenant_id,
  catalog_id,
  installed_version,
  activation_state,
  config,
  rollout,
  created_by,
  updated_by,
  last_health_status,
  last_health_checked_at,
  activated_at,
  deactivated_at,
  created_at,
  updated_at,
  catalog:platform_extension_catalog (
    id,
    slug,
    vendor,
    name,
    description,
    version,
    kind,
    scope,
    source,
    package_path,
    checksum,
    status,
    compatibility,
    capabilities,
    manifest
  )
`;

const LEGACY_SELECT = 'id, tenant_id, slug, name, description, version, extension_type, external_path, manifest, config, is_active, created_at, updated_at';

const buildCatalogRecord = (row) => {
  const catalog = Array.isArray(row.catalog) ? row.catalog[0] : row.catalog;
  const validation = validateExtensionManifest(catalog?.manifest || {}, { allowLegacy: true });
  const manifest = validation.valid ? validation.manifest : null;

  return {
    id: row.id,
    tenant_extension_id: row.id,
    catalog_id: catalog?.id || row.catalog_id || null,
    tenant_id: row.tenant_id || null,
    slug: catalog?.slug || manifest?.slug || null,
    vendor: catalog?.vendor || manifest?.vendor || null,
    name: catalog?.name || manifest?.name || null,
    description: catalog?.description || null,
    installed_version: row.installed_version || catalog?.version || manifest?.version || '1.0.0',
    catalog_version: catalog?.version || manifest?.version || '1.0.0',
    activation_state: row.activation_state || 'inactive',
    kind: catalog?.kind || manifest?.kind || 'external',
    scope: catalog?.scope || manifest?.scope || 'tenant',
    source: catalog?.source || 'workspace',
    package_path: catalog?.package_path || null,
    checksum: catalog?.checksum || null,
    status: catalog?.status || 'active',
    compatibility: catalog?.compatibility || manifest?.compatibility || {},
    capabilities: Array.isArray(catalog?.capabilities) ? catalog.capabilities : manifest?.capabilities || [],
    config: row.config || {},
    rollout: row.rollout || {},
    created_by: row.created_by || null,
    updated_by: row.updated_by || null,
    manifest,
    validationErrors: validation.valid ? [] : validation.errors,
    is_active: row.activation_state === 'active',
    last_health_status: row.last_health_status || 'unknown',
    last_health_checked_at: row.last_health_checked_at || null,
    activated_at: row.activated_at || null,
    deactivated_at: row.deactivated_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
};

const buildLegacyRecord = (row) => {
  const manifest = normalizeCatalogManifest({
    ...row.manifest,
    ...row.config,
    slug: row.slug,
    name: row.name,
    version: row.version,
    extension_type: row.extension_type,
    external_path: row.external_path,
  }, { allowLegacy: true });

  return {
    id: row.id,
    tenant_extension_id: row.id,
    catalog_id: row.id,
    tenant_id: row.tenant_id || null,
    slug: manifest.slug,
    vendor: manifest.vendor,
    name: manifest.name,
    description: row.description || null,
    installed_version: row.version || manifest.version,
    catalog_version: row.version || manifest.version,
    activation_state: row.is_active ? 'active' : 'inactive',
    kind: manifest.kind,
    scope: manifest.scope,
    source: manifest.kind === 'external' ? 'workspace' : 'bundled',
    package_path: row.external_path || null,
    checksum: null,
    status: 'active',
    compatibility: manifest.compatibility,
    capabilities: manifest.capabilities,
    config: row.config || {},
    rollout: {},
    created_by: null,
    updated_by: null,
    manifest,
    validationErrors: [],
    is_active: Boolean(row.is_active),
    last_health_status: 'unknown',
    last_health_checked_at: null,
    activated_at: row.is_active ? row.updated_at || row.created_at : null,
    deactivated_at: row.is_active ? null : row.updated_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
};

export const listTenantExtensions = async ({ tenantId = null, onlyActive = false } = {}) => {
  let query = supabase
    .from('tenant_extensions')
    .select(CATALOG_SELECT)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (tenantId) {
    query = query.eq('tenant_id', tenantId);
  }

  if (onlyActive) {
    query = query.eq('activation_state', 'active');
  }

  const { data, error } = await query;
  if (!error) {
    return (data || []).map(buildCatalogRecord).filter((entry) => entry.manifest);
  }

  const { data: legacyData, error: legacyError } = await supabase
    .from('extensions')
    .select(LEGACY_SELECT)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (legacyError) {
    throw error;
  }

  const filtered = (legacyData || []).filter((row) => {
    if (tenantId && row.tenant_id !== tenantId) return false;
    if (onlyActive && !row.is_active) return false;
    return true;
  });

  return filtered.map(buildLegacyRecord);
};

export const listActiveTenantExtensions = async (tenantId) => listTenantExtensions({ tenantId, onlyActive: true });

export const listExtensionCatalog = async () => {
  const { data, error } = await supabase
    .from('platform_extension_catalog')
    .select('id, slug, vendor, name, description, version, kind, scope, source, package_path, checksum, status, compatibility, capabilities, manifest, created_at, updated_at')
    .is('deleted_at', null)
    .order('name', { ascending: true });

  if (error) {
    return [];
  }

  return (data || []).map((row) => {
      try {
        const manifest = normalizeCatalogManifest(row.manifest || {}, { allowLegacy: true });
        return {
          ...row,
          manifest,
          permissions: manifest.permissions,
          adminRoutes: manifest.adminRoutes,
          menus: manifest.menus,
          publicModules: manifest.publicModules,
          widgets: manifest.widgets,
        };
      } catch (_error) {
        return null;
      }
    }).filter(Boolean);
};

export const listExtensionLifecycleLogs = async ({ tenantId = null } = {}) => {
  let query = supabase
    .from('extension_lifecycle_audit')
    .select('id, tenant_id, catalog_id, tenant_extension_id, action, status, actor_user_id, metadata, created_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(100);

  if (tenantId) {
    query = query.eq('tenant_id', tenantId);
  }

  const { data, error } = await query;
  if (error) return [];
  return data || [];
};
