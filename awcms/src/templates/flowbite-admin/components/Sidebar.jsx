import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
    LayoutDashboard,
    Settings,
    FileText,
    Users,
    ShoppingBag,
    ChevronDown,
    ChevronUp,
    Megaphone,
    Puzzle
} from 'lucide-react';
import { cn } from '@/lib/utils';

const SidebarItem = ({ href, icon: Icon, label, active }) => (
    <li>
        <Link
            to={href}
            className={cn(
                "flex items-center p-2 text-base text-foreground rounded-lg hover:bg-accent group",
                active && "bg-accent"
            )}
        >
            <Icon className="w-6 h-6 text-muted-foreground transition duration-75 group-hover:text-foreground" />
            <span className="ml-3">{label}</span>
        </Link>
    </li>
);

const SidebarDropdown = ({ icon: Icon, label, children, id, active }) => {
    const [isOpen, setIsOpen] = useState(active);

    return (
        <li>
            <button
                type="button"
                className="flex items-center w-full p-2 text-base text-foreground transition duration-75 rounded-lg group hover:bg-accent"
                onClick={() => setIsOpen(!isOpen)}
                aria-controls={`dropdown-${id}`}
                aria-expanded={isOpen}
            >
                <Icon className="flex-shrink-0 w-6 h-6 text-muted-foreground transition duration-75 group-hover:text-foreground" />
                <span className="flex-1 ml-3 text-left whitespace-nowrap">{label}</span>
                {isOpen ? (
                    <ChevronUp className="w-6 h-6" />
                ) : (
                    <ChevronDown className="w-6 h-6" />
                )}
            </button>
            <ul id={`dropdown-${id}`} className={cn("py-2 space-y-2", !isOpen && "hidden")}>
                {children}
            </ul>
        </li>
    );
};

const Sidebar = ({ isOpen, onClose }) => {
    const location = useLocation();
    const path = location.pathname;
    const [searchQuery, setSearchQuery] = useState('');

    // Helper to check active state
    const isActive = (p) => path === p || path.startsWith(`${p}/`);

    const MENU_ITEMS = [
        { label: 'Dashboard', href: '/cmspanel', icon: LayoutDashboard },
        {
            label: 'Content',
            icon: FileText,
            id: 'content',
            children: [
                { label: 'Articles', href: '/cmspanel/articles' },
                { label: 'Pages', href: '/cmspanel/pages' },
                { label: 'Visual Pages', href: '/cmspanel/visual-pages' },
                { label: 'Categories', href: '/cmspanel/categories' },
                { label: 'Tags', href: '/cmspanel/tags' },
                { label: 'Media Library', href: '/cmspanel/files' },
            ]
        },
        {
            label: 'Commerce & Services',
            icon: ShoppingBag,
            id: 'commerce',
            children: [
                { label: 'Products', href: '/cmspanel/products' },
                { label: 'Orders', href: '/cmspanel/orders' },
                { label: 'Services', href: '/cmspanel/services' },
                { label: 'Portfolio', href: '/cmspanel/portfolio' },
                { label: 'Promotions', href: '/cmspanel/promotions' },
            ]
        },
        {
            label: 'Engagement',
            icon: Megaphone,
            id: 'engagement',
            children: [
                { label: 'Announcements', href: '/cmspanel/announcements' },
                { label: 'Testimonies', href: '/cmspanel/testimonies' },
                { label: 'Messages', href: '/cmspanel/messages' },
                { label: 'Photo Gallery', href: '/cmspanel/photo-gallery' },
                { label: 'Video Gallery', href: '/cmspanel/video-gallery' },
            ]
        },
        {
            label: 'Extension & UI',
            icon: Puzzle,
            id: 'extension',
            children: [
                { label: 'Themes', href: '/cmspanel/themes' },
                { label: 'Extensions', href: '/cmspanel/extensions' },
                { label: 'Templates', href: '/cmspanel/templates' },
                { label: 'Widgets', href: '/cmspanel/widgets' },
            ]
        },
        {
            label: 'Access Control',
            icon: Users,
            id: 'users',
            children: [
                { label: 'Users', href: '/cmspanel/users' },
                { label: 'Roles', href: '/cmspanel/roles' },
                { label: 'Permissions', href: '/cmspanel/permissions' },
                { label: 'Mobile Users', href: '/cmspanel/mobile/users' },
            ]
        },
        {
            label: 'System',
            icon: Settings,
            id: 'system',
            children: [
                { label: 'Settings', href: '/cmspanel/settings/general' },
                { label: 'SEO', href: '/cmspanel/seo' },
                { label: 'Audit Logs', href: '/cmspanel/logs' },
                { label: 'Tenants', href: '/cmspanel/tenants' },
                { label: 'IoT Devices', href: '/cmspanel/devices' },
            ]
        }
    ];

    const filteredItems = MENU_ITEMS.map(item => {
        if (item.children) {
            const visibleChildren = item.children.filter(child =>
                child.label.toLowerCase().includes(searchQuery.toLowerCase())
            );

            // If main label matches, show all children. Else, show only matching children.
            if (item.label.toLowerCase().includes(searchQuery.toLowerCase())) {
                return { ...item, isOpen: true }; // Force open if parent matches
            }

            if (visibleChildren.length > 0) {
                return { ...item, children: visibleChildren, isOpen: true }; // Force open if children match
            }
            return null; // Hide if no match
        } else {
            if (item.label.toLowerCase().includes(searchQuery.toLowerCase())) {
                return item;
            }
            return null;
        }
    }).filter(Boolean);

    return (
        <>
            {/* Overlay for mobile when sidebar is open */}
            {isOpen && (
                <div
                    className="fixed inset-0 z-10 bg-black/50 lg:hidden"
                    onClick={onClose}
                    aria-hidden="true"
                />
            )}
            <aside
                id="sidebar"
                className={cn(
                    "fixed top-0 left-0 z-20 flex flex-col flex-shrink-0 w-64 h-full pt-16 font-normal duration-200 transition-transform",
                    "bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700",
                    // On mobile: hidden by default, slide in when isOpen
                    // On desktop (lg+): always visible
                    isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
                )}
                aria-label="Sidebar"
            >
                <div className="relative flex flex-col flex-1 min-h-0 pt-0 bg-white dark:bg-slate-900">
                    <div className="flex flex-col flex-1 pt-5 pb-28 overflow-y-auto scrollbar scrollbar-w-2 scrollbar-thumb-rounded-[0.1667rem] scrollbar-thumb-slate-200 scrollbar-track-gray-400 dark:scrollbar-thumb-slate-900 dark:scrollbar-track-gray-800">
                        <div className="flex-1 px-3 space-y-1 bg-white dark:bg-slate-900 divide-y divide-slate-200 dark:divide-slate-700">
                            {/* Search Input */}
                            <div className="pb-4">
                                <label htmlFor="sidebar-search" className="sr-only">Search</label>
                                <div className="relative">
                                    <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                                        <svg className="w-5 h-5 text-muted-foreground" aria-hidden="true" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                                            <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd"></path>
                                        </svg>
                                    </div>
                                    <input
                                        type="text"
                                        name="search"
                                        id="sidebar-search"
                                        className="block w-full pl-10 p-2.5 text-sm rounded-lg focus:ring-primary focus:border-primary transition-colors !bg-slate-950/50 !text-slate-200 !border-slate-800 placeholder:text-slate-500"
                                        placeholder="Search"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                    />
                                </div>
                            </div>

                            <ul className="pb-2 space-y-2">
                                {filteredItems.map((item, index) => (
                                    item.children ? (
                                        <SidebarDropdown
                                            key={index}
                                            icon={item.icon}
                                            label={item.label}
                                            id={item.id}
                                            active={item.isOpen}
                                        >
                                            {item.children.map((child, cIndex) => (
                                                <li key={cIndex}>
                                                    <Link to={child.href} className="flex items-center p-2 text-base text-foreground transition duration-75 rounded-lg pl-11 group hover:bg-accent">
                                                        {child.label}
                                                    </Link>
                                                </li>
                                            ))}
                                        </SidebarDropdown>
                                    ) : (
                                        <SidebarItem
                                            key={index}
                                            href={item.href}
                                            icon={item.icon}
                                            label={item.label}
                                            active={item.toCheck ? isActive(item.toCheck) : (path === item.href)}
                                        />
                                    )
                                ))}
                            </ul>


                        </div>
                    </div>
                </div>
            </aside>
        </>
    );
};

export default Sidebar;
