import { supabase } from '@/lib/customSupabaseClient';

const invokeLifecycle = async (action, payload = {}) => {
  const { data, error } = await supabase.functions.invoke('extensions-lifecycle', {
    body: {
      action,
      ...payload,
    },
  });

  if (error) {
    throw error;
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  return data;
};

export const registerCatalogManifest = async (manifest, options = {}) => invokeLifecycle('catalog-register', {
  manifest,
  packagePath: options.packagePath || null,
  checksum: options.checksum || null,
  status: options.status || 'active',
  source: options.source || 'workspace',
});

export const installTenantExtension = async ({ catalogId, tenantId, config = {}, autoActivate = true }) => invokeLifecycle('install', {
  catalogId,
  tenantId,
  config,
  autoActivate,
});

export const activateTenantExtension = async ({ tenantExtensionId, tenantId }) => invokeLifecycle('activate', {
  tenantExtensionId,
  tenantId,
});

export const deactivateTenantExtension = async ({ tenantExtensionId, tenantId }) => invokeLifecycle('deactivate', {
  tenantExtensionId,
  tenantId,
});

export const uninstallTenantExtension = async ({ tenantExtensionId, tenantId }) => invokeLifecycle('uninstall', {
  tenantExtensionId,
  tenantId,
});

export const updateTenantExtensionConfig = async ({ tenantExtensionId, tenantId, config }) => invokeLifecycle('config-update', {
  tenantExtensionId,
  tenantId,
  config,
});

export const runExtensionHealthCheck = async ({ tenantId = null }) => invokeLifecycle('health-check', { tenantId });
