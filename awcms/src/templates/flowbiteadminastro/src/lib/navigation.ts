export interface NavItem {
    title: string;
    href?: string;
    icon?: string;
    children?: NavItem[];
    external?: boolean;
}

export const navigation: NavItem[] = [
    {
        title: 'Welcome',
        href: '',
        icon: 'home',
    },
    {
        title: 'Dashboard',
        href: 'dashboard',
        icon: 'chart-pie',
    },
    {
        title: 'Layouts',
        icon: 'layout',
        children: [
            { title: 'Stacked', href: 'layouts/stacked' },
            { title: 'Sidebar', href: 'layouts/sidebar' },
        ],
    },
    {
        title: 'CRUD',
        icon: 'table',
        children: [
            { title: 'Products', href: 'crud/products' },
            { title: 'Users', href: 'crud/users' },
        ],
    },
    {
        title: 'Settings',
        href: 'settings',
        icon: 'cog',
    },
    {
        title: 'Pages',
        icon: 'document-duplicate',
        children: [
            { title: 'Pricing', href: 'pages/pricing' },
            { title: 'Maintenance', href: 'pages/maintenance' },
            { title: '404 not found', href: 'pages/404' },
            { title: '500 server error', href: 'pages/500' },
        ],
    },
    {
        title: 'Authentication',
        icon: 'lock-closed',
        children: [
            { title: 'Sign in', href: 'authentication/sign-in' },
            { title: 'Sign up', href: 'authentication/sign-up' },
            { title: 'Forgot password', href: 'authentication/forgot-password' },
            { title: 'Reset password', href: 'authentication/reset-password' },
            { title: 'Profile lock', href: 'authentication/profile-lock' },
        ],
    },
    {
        title: 'Playground',
        icon: 'play',
        children: [
            { title: 'Stacked', href: 'playground/stacked' },
            { title: 'Sidebar', href: 'playground/sidebar' },
            { title: 'API data', href: 'playground/data' },
        ],
    },
];

export const externalLinks: NavItem[] = [
    {
        title: 'GitHub Repository',
        href: 'https://github.com/themesberg/flowbite-astro-admin-dashboard',
        icon: 'github',
        external: true,
    },
    {
        title: 'Flowbite Docs',
        href: 'https://flowbite.com/docs/getting-started/introduction/',
        icon: 'clipboard-list',
        external: true,
    },
    {
        title: 'Components',
        href: 'https://flowbite.com/docs/components/alerts/',
        icon: 'collection',
        external: true,
    },
    {
        title: 'Support',
        href: 'https://github.com/themesberg/flowbite-astro-admin-dashboard/issues',
        icon: 'support',
        external: true,
    },
];
