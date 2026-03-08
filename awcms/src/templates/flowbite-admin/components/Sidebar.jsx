import { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Search, LayoutGrid, X, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAdminMenu } from '@/hooks/useAdminMenu';
import { useTranslation } from 'react-i18next';
import { usePermissions } from '@/contexts/PermissionContext';
import { useTenant } from '@/contexts/TenantContext';
import { getIconComponent } from '@/lib/adminIcons';
import { filterMenuItemsForSidebar } from '@/lib/adminMenuUtils';

const SidebarItem = ({ href, icon: Icon, label, active, onClick }) => (
    <li>
        <Link
            to={href}
            onClick={onClick}
            className={cn(
                "group relative flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm font-medium transition-all",
                active
                    ? "border-primary/25 bg-primary/10 text-primary shadow-sm"
                    : "border-transparent text-muted-foreground hover:border-border/70 hover:bg-accent/60 hover:text-foreground"
            )}
        >
            {active && (
                <span className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-primary" />
            )}

            <span
                className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors",
                    active
                        ? "border-primary/20 bg-primary/15"
                        : "border-border/50 bg-card/70 group-hover:border-border"
                )}
            >
                {Icon && (
                    <Icon
                        className={cn(
                            "h-4 w-4 transition-colors",
                            active ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                        )}
                    />
                )}
            </span>

            <span className="truncate">{label}</span>
            <ChevronRight
                className={cn(
                    "ml-auto h-4 w-4 shrink-0 transition-opacity",
                    active ? "opacity-100 text-primary" : "opacity-0 text-muted-foreground group-hover:opacity-100"
                )}
            />
        </Link>
    </li>
);

const Sidebar = ({ isOpen, onClose }) => {
    const location = useLocation();
    const { t } = useTranslation();
    const { menuItems, loading } = useAdminMenu();
    const { hasPermission, hasAnyPermission, isPlatformAdmin, isFullAccess, isTenantAdmin, userRole } = usePermissions();
    const { currentTenant } = useTenant();

    const [searchQuery, setSearchQuery] = useState('');

    const isActive = (path) => {
        const normalizedPath = (path || '').replace(/^\/+|\/+$/g, '');
        if (!normalizedPath || normalizedPath === 'home') {
            return location.pathname === '/cmspanel' || location.pathname === '/cmspanel/';
        }

        return location.pathname === `/cmspanel/${normalizedPath}` || location.pathname.startsWith(`/cmspanel/${normalizedPath}/`);
    };

    const groupedMenus = useMemo(() => {
        if (loading) return {};

        const authorizedItems = filterMenuItemsForSidebar({
            items: menuItems,
            hasPermission,
            hasAnyPermission,
            isPlatformAdmin,
            isFullAccess,
            isTenantAdmin,
            subscriptionTier: currentTenant?.subscription_tier,
            userRole,
            loading
        });

        const filteredItems = searchQuery
            ? authorizedItems.filter(item =>
                item.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
                t(`menu.${item.key}`, item.label).toLowerCase().includes(searchQuery.toLowerCase())
            )
            : authorizedItems;

        // Grouping
        const groups = {
            tenant: { label: currentTenant ? `🏠 TENANT: ${currentTenant.name}` : '🏠 TENANT', order: 0, items: [] },
            platform: { label: '🏢 PLATFORM', order: 1, items: [] }
        };

        filteredItems.forEach(item => {
            if (item.scope === 'platform') {
                groups.platform.items.push(item);
            } else {
                groups.tenant.items.push(item);
            }
        });

        // Sort items within their original groups before we flattened the structure
        Object.keys(groups).forEach(key => groups[key].items.sort((a, b) => {
            if ((a.group_order || 0) !== (b.group_order || 0)) {
                return (a.group_order || 0) - (b.group_order || 0);
            }
            return (a.order || 0) - (b.order || 0);
        }));

        // Remove empty top-level groups to keep UI clean
        const activeGroups = {};
        if (groups.platform.items.length > 0) activeGroups.platform = groups.platform;
        if (groups.tenant.items.length > 0) activeGroups.tenant = groups.tenant;

        return activeGroups;
    }, [menuItems, loading, isPlatformAdmin, isFullAccess, hasPermission, hasAnyPermission, searchQuery, t, userRole, currentTenant]);

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
                    "fixed top-0 left-0 z-30 h-full w-64 pt-[72px] transition-transform duration-200",
                    "border-r border-border/70 bg-card/85 text-foreground shadow-xl shadow-slate-900/5 backdrop-blur-xl dark:shadow-black/25",
                    isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
                )}
                aria-label="Sidebar"
            >
                <div className="pointer-events-none absolute inset-x-0 top-16 h-20 bg-[radial-gradient(240px_80px_at_10%_0%,rgba(59,130,246,0.16),transparent_70%)] dark:bg-[radial-gradient(240px_80px_at_10%_0%,rgba(37,99,235,0.26),transparent_70%)]" />

                <div className="relative flex h-full min-h-0 flex-col">
                    <div className="flex h-12 items-center justify-end px-4 lg:hidden">
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                            aria-label="Close sidebar"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>

                    <div className="px-3 pt-4">
                        <label htmlFor="sidebar-search" className="sr-only">Search</label>
                        <div className="relative">
                            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                                <Search className="h-4 w-4 text-muted-foreground" />
                            </div>
                            <input
                                type="text"
                                name="search"
                                id="sidebar-search"
                                className="block w-full rounded-xl border border-border/70 bg-muted/40 p-2.5 pl-10 text-sm text-foreground placeholder:text-muted-foreground/80 transition-colors focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                                placeholder={t('sidebar.search_placeholder', 'Search')}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="custom-scrollbar flex-1 overflow-y-auto px-3 pb-6 pt-4">
                        <ul className="space-y-2 pb-2">
                            {loading && (
                                <div className="space-y-4 px-2">
                                    {[1, 2, 3].map(i => (
                                        <div key={i} className="h-10 w-full rounded-xl bg-muted/60 animate-pulse" />
                                    ))}
                                </div>
                            )}

                            {!loading && sortedGroupKeys.map(topGroupKey => {
                                const topGroup = groupedMenus[topGroupKey];

                                // Sub-group the items for this top-level section
                                const subGroups = {};
                                topGroup.items.forEach(item => {
                                    const subLabel = item.group_label || 'General';
                                    if (!subGroups[subLabel]) {
                                        subGroups[subLabel] = { order: item.group_order || 999, items: [] };
                                    }
                                    subGroups[subLabel].items.push(item);
                                });

                                const sortedSubGroupKeys = Object.keys(subGroups).sort((a, b) =>
                                    subGroups[a].order - subGroups[b].order
                                );

                                return (
                                    <div key={topGroupKey} className="pt-2 mb-4">
                                        <div className="mb-2 px-2">
                                            <h2 className="text-xs font-bold uppercase tracking-widest text-primary/80 dark:text-primary/70">
                                                {topGroup.label}
                                            </h2>
                                        </div>

                                        {sortedSubGroupKeys.map(subGroupLabel => {
                                            const subGroup = subGroups[subGroupLabel];
                                            return (
                                                <div key={`${topGroupKey}-${subGroupLabel}`} className="pt-1 mb-2 pl-2 border-l border-border/50 ml-2">
                                                    {subGroupLabel !== 'General' && (
                                                        <div className="mb-1.5 flex items-center gap-2">
                                                            <h3 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/80">
                                                                {subGroupLabel}
                                                            </h3>
                                                        </div>
                                                    )}

                                                    <ul className="space-y-1">
                                                        {subGroup.items.map(item => {
                                                            const Icon = getIconComponent(item.icon);
                                                            return (
                                                                <SidebarItem
                                                                    key={item.id}
                                                                    href={item.path ? `/cmspanel/${item.path}` : '/cmspanel'}
                                                                    icon={Icon}
                                                                    label={t(`menu.${item.key}`, item.label)}
                                                                    active={isActive(item.path)}
                                                                    onClick={() => {
                                                                        if (typeof window !== 'undefined' && window.innerWidth < 1024) {
                                                                            onClose();
                                                                        }
                                                                    }}
                                                                />
                                                            );
                                                        })}
                                                    </ul>
                                                </div>
                                            );
                                        })}
                                    </div>
                                );
                            })}
                        </ul>
                    </div>

                </div>
            </aside>
        </>
    );
};

export default Sidebar;
