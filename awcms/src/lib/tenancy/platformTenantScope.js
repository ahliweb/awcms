const STORAGE_KEY = 'awcms_platform_tenant_scope';

export const getStoredPlatformTenantScope = () => {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage.getItem(STORAGE_KEY) || null;
};

export const setStoredPlatformTenantScope = (tenantId) => {
  if (typeof window === 'undefined') return;
  if (!tenantId) {
    window.sessionStorage.removeItem(STORAGE_KEY);
    return;
  }
  window.sessionStorage.setItem(STORAGE_KEY, tenantId);
};

export const clearStoredPlatformTenantScope = () => {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(STORAGE_KEY);
};
