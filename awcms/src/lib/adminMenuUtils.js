import { checkTierAccess } from '@/lib/tierFeatures';

const GROUP_LABEL_MAP = {
  content: 'CONTENT',
  media: 'MEDIA',
  commerce: 'COMMERCE',
  navigation: 'NAVIGATION',
  users: 'USERS',
  system: 'SYSTEM',
  configuration: 'CONFIGURATION',
  settings: 'CONFIGURATION',
  config: 'CONFIGURATION',
  platform: 'PLATFORM',
  mobile: 'MOBILE',
  iot: 'IoT',
  dashboard: 'CONTENT',
  plugins: 'PLUGINS',
  extensions: 'EXTENSIONS',
  general: 'General'
};

export const GROUP_ORDER_MAP = {
  CONTENT: 10,
  MEDIA: 20,
  COMMERCE: 30,
  NAVIGATION: 40,
  USERS: 50,
  SYSTEM: 60,
  CONFIGURATION: 70,
  IoT: 80,
  MOBILE: 85,
  PLATFORM: 100,
  PLUGINS: 900,
  EXTENSIONS: 900,
  General: 999
};

const FEATURE_KEY_MAP = {
  branding: 'settings_branding'
};

const RESOURCE_PATH_MAP = {
  visual_builder: 'visual-pages',
  testimonials: 'testimonials',
  visitor_stats: 'visitor-stats',
  sidebar_manager: 'admin-navigation',
  settings_general: 'settings/general',
  settings_branding: 'settings/branding',
  school_pages: 'school-pages',
  site_images: 'site-images',
  email_settings: 'email-settings',
  email_logs: 'email-logs',
  mobile_config: 'mobile/config',
  mobile_users: 'mobile/users',
  push_notifications: 'mobile/push',
  iot_devices: 'devices',
  seo_manager: 'seo',
};

export const normalizeMenuPath = (value) => {
  if (!value) return '';
  return value.replace(/^\/?admin\/?/, '').replace(/^\/+/, '');
};

export const resolveResourcePath = (key, fallbackPath = '') => {
  if (!key) return normalizeMenuPath(fallbackPath);
  return RESOURCE_PATH_MAP[key] || normalizeMenuPath(fallbackPath) || key;
};

export const normalizeGroupLabel = (value) => {
  if (!value) return 'General';
  const trimmed = String(value).trim();
  if (!trimmed) return 'General';
  const mapped = GROUP_LABEL_MAP[trimmed.toLowerCase()];
  return mapped || trimmed;
};

export const resolveGroupMeta = (rawLabel, fallbackOrder) => {
  const label = normalizeGroupLabel(rawLabel);
  const order = GROUP_ORDER_MAP[label] ?? fallbackOrder ?? 999;
  return { label, order };
};

export const getMenuFeatureKey = (item) => {
  if (!item) return '';
  const rawKey = item.feature_key || item.featureKey || item.key || item.id || '';
  return FEATURE_KEY_MAP[rawKey] || rawKey;
};

export const filterMenuItemsForSidebar = ({
  items,
  hasPermission,
  isPlatformAdmin,
  isFullAccess,
  subscriptionTier,
  applyFilters,
  userRole,
  hasAnyPermission,
  isTenantAdmin // Add isTenantAdmin parameter
}) => {
  const baseItems = Array.isArray(items) ? items : [];
  let filtered = baseItems.filter((item) => {
    if (!item?.is_visible) return false;
    if (item.permission === 'super_admin_only') return isFullAccess || isPlatformAdmin;
    if (item.permission === 'platform_admin_only') return isPlatformAdmin || isFullAccess;

    if (isPlatformAdmin || isFullAccess || isTenantAdmin) return true; // Allow tenant admins too

    if (!isPlatformAdmin && !isFullAccess) {
      const featureKey = getMenuFeatureKey(item);
      if (!checkTierAccess(subscriptionTier, featureKey)) return false;
    }

    if (item.permission) {
      // Special handling for School Modules to allow Platform access
      // This acts as a shim for existing DB rows that only have the tenant permission
      let requiredPerms = item.permission;
      if (requiredPerms === 'tenant.school_pages.read') {
        requiredPerms = ['tenant.school_pages.read', 'platform.school_pages.read'];
      }

      if (Array.isArray(requiredPerms)) {
        // If hasAnyPermission is provided, use it. Otherwise fallback to checking if SOME permission is held.
        if (hasAnyPermission) {
          return hasAnyPermission(requiredPerms);
        }
        // Fallback if hasAnyPermission is not passed (though it should be)
        return requiredPerms.some(p => hasPermission(p));
      }
      return hasPermission(requiredPerms);
    }
    return true;
  });

  if (applyFilters) {
    filtered = applyFilters('admin_sidebar_menu', filtered, { userRole, hasPermission });
  }

  return filtered.map((item) => {
    const { label: groupLabel, order: groupOrder } = resolveGroupMeta(
      item.group_label,
      item.group_order
    );
    return {
      ...item,
      group_label: groupLabel,
      group_order: groupOrder
    };
  });
};
