import { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Search, LayoutGrid, X, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAdminMenu } from '@/hooks/useAdminMenu';
import { useTranslation } from 'react-i18next';
import { usePermissions } from '@/contexts/PermissionContext';
import { useTenant } from '@/contexts/TenantContext';
import { getIconComponent } from '@/lib/adminIcons';
import { filterMenuItemsForSidebar, resolveGroupMeta } from '@/lib/adminMenuUtils';

const SidebarItem = ({ href, icon: Icon, label, active, onClick }) => (
    <li>
        <Link
            to={href}
            onClick={onClick}
            className={cn(
                "group relative flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm font-medium transition-all",
                active
                    ? "border-white/12 bg-white/10 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]"
                    : "border-transparent text-slate-300/82 hover:border-white/10 hover:bg-white/6 hover:text-white"
            )}
        >
            {active && (
                <span className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-sky-400" />
            )}

            <span
                className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors",
                    active
                        ? "border-white/12 bg-white/10"
                        : "border-white/8 bg-white/[0.035] group-hover:border-white/12"
                )}
            >
                {Icon && (
                    <Icon
                        className={cn(
                            "h-4 w-4 transition-colors",
                            active ? "text-sky-300" : "text-slate-400 group-hover:text-white"
                        )}
                    />
                )}
            </span>

            <span className="truncate">{label}</span>
            <ChevronRight
                className={cn(
                    "ml-auto h-4 w-4 shrink-0 transition-opacity",
                    active ? "opacity-100 text-sky-300" : "opacity-0 text-slate-500 group-hover:opacity-100"
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

        const groups = {};

        filteredItems.forEach((item) => {
            const { label, order } = resolveGroupMeta(item.group_label, item.group_order);
            if (!groups[label]) {
                groups[label] = { label, order, items: [] };
            }
            groups[label].items.push(item);
        });

        Object.values(groups).forEach((group) => {
            group.items.sort((a, b) => {
                if ((a.order || 0) !== (b.order || 0)) {
                    return (a.order || 0) - (b.order || 0);
                }
                return String(a.label || '').localeCompare(String(b.label || ''));
            });
        });

        return groups;
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
                    "fixed left-0 z-30 w-64 transition-transform duration-200",
                    "emdash-rail border-r border-white/8 backdrop-blur-xl",
                    isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
                )}
                style={{ top: 'calc(var(--header-h) + 0.75rem)', height: 'calc(100vh - var(--header-h) - 1.5rem)' }}
                aria-label="Sidebar"
            >
                <div className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[radial-gradient(260px_120px_at_10%_0%,rgba(56,189,248,0.22),transparent_60%),radial-gradient(220px_120px_at_100%_100%,rgba(129,140,248,0.18),transparent_55%)]" />

                <div className="relative flex h-full min-h-0 flex-col">
                    <div className="flex h-11 items-center justify-between px-4 border-b border-white/10 lg:hidden">
                        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Sections</span>
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/8 hover:text-white"
                            aria-label="Close sidebar"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>

                    <div className="px-3 pt-3">
                        <label htmlFor="sidebar-search" className="sr-only">Search</label>
                        <div className="relative">
                            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                                <Search className="h-4 w-4 text-slate-500" />
                            </div>
                            <input
                                type="text"
                                name="search"
                                id="sidebar-search"
                                className="block w-full rounded-2xl border border-white/10 bg-white/[0.045] p-2.5 pl-10 text-sm text-white placeholder:text-slate-500 transition-colors focus:border-sky-400/50 focus:outline-none focus:ring-2 focus:ring-sky-400/20"
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

                                return (
                                    <div key={topGroupKey} className="pt-2 mb-4">
                                        <div className="mb-2 px-2">
                                            <h2 className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">
                                                {topGroup.label}
                                            </h2>
                                        </div>

                                        <div className="pt-1 mb-2 pl-2 border-l border-white/8 ml-2">
                                            <ul className="space-y-1">
                                                {topGroup.items.map(item => {
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
