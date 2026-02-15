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

export const normalizeMenuPath = (value) => {
  if (!value) return '';
  return value.replace(/^\/?admin\/?/, '').replace(/^\/+/, '');
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
  userRole
}) => {
  const baseItems = Array.isArray(items) ? items : [];
  let filtered = baseItems.filter((item) => {
    if (!item?.is_visible) return false;
    if (item.permission === 'super_admin_only') return isFullAccess || isPlatformAdmin;
    if (item.permission === 'platform_admin_only') return isPlatformAdmin;

    if (!isPlatformAdmin && !isFullAccess) {
      const featureKey = getMenuFeatureKey(item);
      if (!checkTierAccess(subscriptionTier, featureKey)) return false;
    }

    if (item.permission) {
      return hasPermission(item.permission);
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
