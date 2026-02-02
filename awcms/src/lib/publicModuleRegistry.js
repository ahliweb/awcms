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
 */

/** @type {PublicModule[]} */
export const PUBLIC_MODULES = [
    // Main pages
    { key: 'home', label: 'Home', url: '/', icon: 'Home', group: 'Main', order: 10 },
    { key: 'about', label: 'About', url: '/about', icon: 'Info', group: 'Main', order: 20 },
    { key: 'contact', label: 'Contact', url: '/contact', icon: 'Mail', group: 'Main', order: 30 },

    // Content modules
    { key: 'blogs', label: 'Blogs', url: '/blogs', icon: 'FileText', group: 'Content', order: 100 },
    { key: 'pages', label: 'Pages', url: '/pages', icon: 'FileEdit', group: 'Content', order: 110 },
    { key: 'portfolio', label: 'Portfolio', url: '/portfolio', icon: 'Briefcase', group: 'Content', order: 120 },
    { key: 'testimonials', label: 'Testimonials', url: '/testimonials', icon: 'MessageSquareQuote', group: 'Content', order: 130 },
    { key: 'announcements', label: 'Announcements', url: '/announcements', icon: 'Megaphone', group: 'Content', order: 140 },
    { key: 'promotions', label: 'Promotions', url: '/promotions', icon: 'Tag', group: 'Content', order: 150 },

    // Media
    { key: 'gallery', label: 'Gallery', url: '/gallery', icon: 'Image', group: 'Media', order: 200 },
    { key: 'photo_gallery', label: 'Photo Gallery', url: '/gallery/photos', icon: 'Image', group: 'Media', order: 210 },
    { key: 'video_gallery', label: 'Video Gallery', url: '/gallery/videos', icon: 'Video', group: 'Media', order: 220 },

    // Commerce
    { key: 'products', label: 'Products', url: '/products', icon: 'Package', group: 'Commerce', order: 300 },
    { key: 'shop', label: 'Shop', url: '/shop', icon: 'ShoppingCart', group: 'Commerce', order: 310 },

    // Legal
    { key: 'privacy', label: 'Privacy Policy', url: '/privacy', icon: 'Shield', group: 'Legal', order: 400 },
    { key: 'terms', label: 'Terms of Service', url: '/terms', icon: 'FileCheck', group: 'Legal', order: 410 },
    { key: 'faq', label: 'FAQ', url: '/faq', icon: 'HelpCircle', group: 'Legal', order: 420 },

    // Discovery
    { key: 'categories', label: 'Categories', url: '/categories', icon: 'FolderTree', group: 'Discovery', order: 500 },
    { key: 'tags', label: 'Tags', url: '/tags', icon: 'Hash', group: 'Discovery', order: 510 },
    { key: 'search', label: 'Search', url: '/search', icon: 'Search', group: 'Discovery', order: 520 },
    { key: 'visitor_stats', label: 'Visitor Statistics', url: '/visitor-stats', icon: 'LineChart', group: 'Discovery', order: 530 },

    // User
    { key: 'login', label: 'Login', url: '/login', icon: 'LogIn', group: 'User', order: 600 },
    { key: 'register', label: 'Register', url: '/register', icon: 'UserPlus', group: 'User', order: 610 },
    { key: 'profile', label: 'Profile', url: '/profile', icon: 'User', group: 'User', order: 620 },
    { key: 'cart', label: 'Cart', url: '/cart', icon: 'ShoppingCart', group: 'User', order: 630 },
];

/**
 * Get modules grouped by category
 * @returns {Object.<string, PublicModule[]>}
 */
export function getModulesByGroup() {
    const groups = {};
    PUBLIC_MODULES.forEach(mod => {
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
