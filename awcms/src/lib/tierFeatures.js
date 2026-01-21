
/**
 * Tier Feature Mapping
 * Defines which features are available for each subscription tier.
 */

export const TIER_FEATURES = {
    free: [
        'home', 'blogs', 'pages', 'visual_builder',
        'categories', 'tags', 'files', 'portfolio', 'testimonials',
        'announcements', 'promotions', 'contact_messages', 'contacts', 'menus', 'products',
        'product_types', 'orders', 'users'
    ],
    pro: [
        // Includes all Free features
        'ALL_FREE',
        'themes', 'widgets', 'roles', 'permissions', 'policies', 'seo_manager', 'languages',
        'notifications', 'audit_logs', 'settings_branding', 'backup', 'regions',
        'photo_gallery', 'video_gallery', 'sidebar_manager'
    ],
    enterprise: [
        // Includes all Pro features
        'ALL_PRO',
        'sso', 'extensions', 'settings_general', 'tenants',
        'email_settings', 'email_logs', 'iot_devices', 'mobile_users', 'push_notifications', 'mobile_config'
    ]
};

const resolveFeatures = (tier) => {
    const tierKey = tier?.toLowerCase() || 'free';

    // Helper to get features recursively (simple implementation)
    const getFeatures = (t) => {
        const list = TIER_FEATURES[t] || [];
        let resolved = [];
        list.forEach(f => {
            if (f === 'ALL_FREE') resolved = [...resolved, ...getFeatures('free')];
            else if (f === 'ALL_PRO') resolved = [...resolved, ...getFeatures('pro')];
            else resolved.push(f);
        });
        return resolved;
    };

    return getFeatures(tierKey);
};

export const checkTierAccess = (tier, featureKey) => {
    // Platform Admins (usually on 'enterprise' or implicit super access) might bypass, 
    // but here we check strictly by tier config.
    // If featureKey is undefined or empty, we assume it's visible (general pages).
    if (!featureKey) return true;

    const allowedFeatures = resolveFeatures(tier);
    // Extensions are special: usually handled by 'extensions' key
    if (featureKey.startsWith('ext-')) return allowedFeatures.includes('extensions');

    return allowedFeatures.includes(featureKey);
};
