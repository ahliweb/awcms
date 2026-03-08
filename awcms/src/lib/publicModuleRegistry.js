/**
 * Public Module Registry
 * 
 * Defines all public-facing routes/pages that can be linked in the
 * frontend navigation (header, footer, etc.).
 * 
 * Used by MenusManager for:
 * - "Add Item" module picker
 * - "Sync From Modules" functionality
 */

/**
 * @typedef {Object} PublicModule
 * @property {string} key - Unique identifier
 * @property {string} label - Display name
 * @property {string} url - Public URL path
 * @property {string} icon - Lucide icon name
 * @property {string} [group] - Optional grouping
 * @property {number} [order] - Sort order
 * @property {string[]} [portalVariants] - Supported public portal variants
 * @property {string[]} [requiredModuleSlugs] - Active tenant modules required for this route
 */

/** @type {PublicModule[]} */
export const PUBLIC_MODULES = [
    { key: 'home', label: 'Home', url: '/', icon: 'Home', group: 'Main', order: 10 },
    { key: 'about', label: 'About', url: '/about', icon: 'Info', group: 'Main', order: 20, portalVariants: ['primary'] },
    { key: 'contact', label: 'Contact', url: '/contact', icon: 'Mail', group: 'Main', order: 30, portalVariants: ['primary'] },
    { key: 'services', label: 'Services', url: '/services', icon: 'Settings', group: 'Main', order: 40, portalVariants: ['primary'] },
    { key: 'pricing', label: 'Pricing', url: '/pricing', icon: 'Wallet', group: 'Main', order: 50, portalVariants: ['primary'] },
    { key: 'blogs', label: 'Blogs', url: '/blogs', icon: 'FileText', group: 'Content', order: 100, requiredModuleSlugs: ['blogs'] },
    { key: 'search', label: 'Search', url: '/search', icon: 'Search', group: 'Discovery', order: 110, portalVariants: ['primary'] },
    { key: 'visitor_stats', label: 'Visitor Statistics', url: '/visitor-stats', icon: 'LineChart', group: 'Discovery', order: 120 },
    { key: 'school_profile', label: 'School Profile', url: '/profil', icon: 'Building2', group: 'School', order: 200, portalVariants: ['smandapbun'], requiredModuleSlugs: ['school_pages'] },
    { key: 'school_organization', label: 'Organization', url: '/profil/struktur-organisasi', icon: 'Users', group: 'School', order: 210, portalVariants: ['smandapbun'], requiredModuleSlugs: ['school_pages'] },
    { key: 'school_staff', label: 'Staff', url: '/profil/tenaga-pendidik', icon: 'UserCheck', group: 'School', order: 220, portalVariants: ['smandapbun'], requiredModuleSlugs: ['school_pages'] },
    { key: 'school_services', label: 'Services', url: '/layanan', icon: 'Settings', group: 'School', order: 230, portalVariants: ['smandapbun'], requiredModuleSlugs: ['school_pages'] },
    { key: 'school_finance', label: 'Finance', url: '/keuangan', icon: 'Wallet', group: 'School', order: 240, portalVariants: ['smandapbun'], requiredModuleSlugs: ['school_pages'] },
    { key: 'school_achievements', label: 'Achievements', url: '/prestasi', icon: 'Trophy', group: 'School', order: 250, portalVariants: ['smandapbun'], requiredModuleSlugs: ['school_pages'] },
    { key: 'school_alumni', label: 'Alumni', url: '/alumni', icon: 'GraduationCap', group: 'School', order: 260, portalVariants: ['smandapbun'], requiredModuleSlugs: ['school_pages'] },
    { key: 'school_agenda', label: 'Agenda', url: '/blogs/agenda', icon: 'CalendarDays', group: 'School', order: 270, portalVariants: ['smandapbun'], requiredModuleSlugs: ['school_pages', 'blogs'] },
    { key: 'school_gallery', label: 'Gallery', url: '/blogs/galeri', icon: 'Image', group: 'School', order: 280, portalVariants: ['smandapbun'], requiredModuleSlugs: ['school_pages', 'blogs'] },
    { key: 'school_contact', label: 'School Contact', url: '/kontak', icon: 'Phone', group: 'School', order: 290, portalVariants: ['smandapbun'], requiredModuleSlugs: ['school_pages'] },
];

export function getPublicPortalVariant(tenant) {
    return tenant?.slug === 'smandapbun' ? 'smandapbun' : 'primary';
}

export function getPublicModulesForTenant(tenant, activeModuleSlugs = []) {
    const portalVariant = getPublicPortalVariant(tenant);
    const activeModuleSet = new Set(activeModuleSlugs.filter(Boolean));

    return PUBLIC_MODULES
        .filter((module) => {
            if (module.portalVariants && !module.portalVariants.includes(portalVariant)) {
                return false;
            }

            if (!module.requiredModuleSlugs || module.requiredModuleSlugs.length === 0) {
                return true;
            }

            return module.requiredModuleSlugs.every((slug) => activeModuleSet.has(slug));
        })
        .sort((a, b) => (a.order || 0) - (b.order || 0));
}

/**
 * Get modules grouped by category
 * @param {Record<string, unknown>} [tenant]
 * @param {string[]} [activeModuleSlugs]
 * @returns {Object.<string, PublicModule[]>}
 */
export function getModulesByGroup(tenant, activeModuleSlugs = []) {
    const groups = {};
    getPublicModulesForTenant(tenant, activeModuleSlugs).forEach(mod => {
        const group = mod.group || 'Other';
        if (!groups[group]) groups[group] = [];
        groups[group].push(mod);
    });
    Object.values(groups).forEach(items => items.sort((a, b) => (a.order || 0) - (b.order || 0)));
    return groups;
}

/**
 * Find a module by key
 * @param {string} key 
 * @returns {PublicModule|undefined}
 */
export function getModuleByKey(key) {
    return PUBLIC_MODULES.find(m => m.key === key);
}

export default PUBLIC_MODULES;
