/**
 * @awcms/shared — Shared utilities for AWCMS public portals.
 *
 * Re-exports all modules for convenience:
 *   import { SANITIZE_BASE_OPTIONS, getLocalizedValue } from '@awcms/shared';
 *
 * Or import specific modules for tree-shaking:
 *   import { SANITIZE_BASE_OPTIONS } from '@awcms/shared/sanitize';
 *   import { createClientFromEnv } from '@awcms/shared/supabase';
 */

export {
    SANITIZE_ALLOWED_TAGS,
    SANITIZE_ALLOWED_ATTRIBUTES,
    SANITIZE_BASE_OPTIONS,
} from './sanitize';
export {
    createClientFromEnv,
    createTenantClient,
    resolveSupabaseCredentials,
    type SupabaseCredentials,
} from './supabase';
export { getTenantId } from './tenant';
export {
    getLocalizedValue,
    type LocalizedString,
    type LocalizedStringArray,
    type NavigationItem,
    type TenantConfig,
    type PortalSite,
} from './types';
