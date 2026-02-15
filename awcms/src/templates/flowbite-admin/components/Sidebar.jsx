import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
    Search
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAdminMenu } from '@/hooks/useAdminMenu';
import { useTranslation } from 'react-i18next';
import { usePermissions } from '@/contexts/PermissionContext';
import { useTenant } from '@/contexts/TenantContext';
import { checkTierAccess } from '@/lib/tierFeatures';
import { getIconComponent } from '@/lib/adminIcons';
import { filterMenuItemsForSidebar } from '@/lib/adminMenuUtils';

const SidebarItem = ({ href, icon: Icon, label, active }) => (
    <li>
        <Link
            to={href}
            className={cn(
                "flex items-center p-2 text-base text-foreground rounded-lg hover:bg-accent group",
                active && "bg-accent"
            )}
        >
            {Icon && <Icon className="w-6 h-6 text-muted-foreground transition duration-75 group-hover:text-foreground" />}
            <span className="ml-3 truncate">{label}</span>
        </Link>
    </li>
);



const Sidebar = ({ isOpen, onClose }) => {
    const location = useLocation();
    const { t } = useTranslation();
    const { menuItems, loading } = useAdminMenu();
    const { hasPermission, hasAnyPermission, isPlatformAdmin, isFullAccess, userRole } = usePermissions();
    const { currentTenant } = useTenant(); // Added

    // Path cleanup logic (same as other Sidebar)

    const [searchQuery, setSearchQuery] = useState('');

    const isActive = (path) => {
        if (!path) return false;
        // Exact match or sub-path
        return location.pathname === `/cmspanel/${path}` || location.pathname.startsWith(`/cmspanel/${path}/`);
    };

    // Filter and Group Logic
    const groupedMenus = React.useMemo(() => {
        if (loading) return {};

        const authorizedItems = filterMenuItemsForSidebar({
            items: menuItems,
            hasPermission,
            hasAnyPermission,
            isPlatformAdmin,
            isFullAccess,
            subscriptionTier: currentTenant?.subscription_tier,
            userRole, // explicit pass
            loading
        });

        const filteredItems = searchQuery
            ? authorizedItems.filter(item =>
                item.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
                t(`menu.${item.key}`, item.label).toLowerCase().includes(searchQuery.toLowerCase())
            )
            : authorizedItems;

        // Grouping
        const groups = {};
        filteredItems.forEach(item => {
            const groupLabel = item.group_label || 'General';
            if (!groups[groupLabel]) {
                groups[groupLabel] = { order: item.group_order || 999, items: [] };
            }
            groups[groupLabel].items.push(item);
        });

        // Sort items within groups
        Object.keys(groups).forEach(key => groups[key].items.sort((a, b) => a.order - b.order));

        return groups;
    }, [menuItems, loading, isPlatformAdmin, isFullAccess, hasPermission, hasAnyPermission, searchQuery, t, currentTenant?.subscription_tier]);

    const sortedGroupKeys = Object.keys(groupedMenus).sort((a, b) =>
        groupedMenus[a].order - groupedMenus[b].order
    );

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
                                        <Search className="w-5 h-5 text-muted-foreground" />
                                    </div>
                                    <input
                                        type="text"
                                        name="search"
                                        id="sidebar-search"
                                        className="block w-full pl-10 p-2.5 text-sm rounded-lg focus:ring-primary focus:border-primary transition-colors !bg-slate-950/50 !text-slate-200 !border-slate-800 placeholder:text-slate-500"
                                        placeholder={t('sidebar.search_placeholder', 'Search')}
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                    />
                                </div>
                            </div>

                            {/* Dynamic Menu Rendering */}
                            <ul className="pb-2 space-y-2">
                                {loading && (
                                    <div className="space-y-4 px-2">
                                        {[1, 2, 3].map(i => (
                                            <div key={i} className="h-10 w-full bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
                                        ))}
                                    </div>
                                )}

                                {!loading && sortedGroupKeys.map(groupLabel => {
                                    const group = groupedMenus[groupLabel];
                                    // Identify if we want to render groups as labeled sections or collapsible
                                    // For Flowbite theme, typically acts as a list. Warning: Flowbite sidebar design is flat or nested? 
                                    // The updated design supports groups. Let's just render a divider title if needed, 
                                    // or just render items.
                                    // However, the previous hardcoded menu had nested Dropdowns. 
                                    // Our dynamic structure is flat list with groups. 
                                    // To match the previous UX ("Content" -> "Blogs"), we might need to map groups to Dropdowns?
                                    // OR, we just render headers for groups.

                                    // Option A: Render Group Header and Items
                                    return (
                                        <div key={groupLabel} className="pt-2">
                                            {groupLabel !== 'General' && (
                                                <h3 className="px-2 pb-2 text-xs font-semibold text-gray-500 uppercase dark:text-gray-400">
                                                    {groupLabel}
                                                </h3>
                                            )}
                                            {group.items.map(item => {
                                                const Icon = getIconComponent(item.icon);
                                                // Assuming flat structure for now as per `useAdminMenu` output
                                                // If `useAdminMenu` returns a flat list (which it does), we render them.
                                                return (
                                                    <SidebarItem
                                                        key={item.id}
                                                        href={`/cmspanel/${item.path}`}
                                                        icon={Icon}
                                                        label={t(`menu.${item.key}`, item.label)}
                                                        active={isActive(item.path)}
                                                    />
                                                );
                                            })}
                                        </div>
                                    )
                                })}
                            </ul>
                        </div>
                    </div>
                </div>
            </aside>
        </>
    );
};

export default Sidebar;
