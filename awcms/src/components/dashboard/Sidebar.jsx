
import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation } from 'react-router-dom';
import { X, LogOut, ChevronDown, ChevronRight, Search, LayoutGrid } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/contexts/PermissionContext';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useAdminMenu } from '@/hooks/useAdminMenu';
import { getIconComponent } from '@/lib/adminIcons';
import { usePlugins } from '@/contexts/PluginContext';
import { TenantUsage } from './TenantUsage';
import { useTenant } from '@/contexts/TenantContext';
import { filterMenuItemsForSidebar } from '@/lib/adminMenuUtils';

function Sidebar({ isOpen, setIsOpen }) {
  const { t } = useTranslation();
  const { hasPermission, userRole, isPlatformAdmin, isFullAccess } = usePermissions();
  const { currentTenant } = useTenant();
  const { signOut } = useAuth();
  const { applyFilters } = usePlugins(); // Moved to top level
  const navigate = useNavigate();
  const location = useLocation();
  const { menuItems, loading } = useAdminMenu();

  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState(new Set());

  const currentPath = location.pathname.split('/cmspanel/')[1] || 'home';

  const handleNavigation = (path) => {
    // Handle empty, null, undefined, or root path
    if (!path || path === '' || path === '/' || path === 'home') {
      navigate('/cmspanel');
    }
    // Prevent external URLs (http, https, mailto, etc.)
    else if (path.includes('://') || path.startsWith('mailto:') || path.startsWith('tel:')) {
      return; // Don't navigate to external URLs
    }
    // Handle path that's just a slash followed by nothing useful
    else if (path.trim() === '/' || path.trim() === '') {
      navigate('/cmspanel');
    }
    else {
      // Strip any leading slashes
      let cleanPath = path;
      while (cleanPath.startsWith('/')) {
        cleanPath = cleanPath.slice(1);
      }

      // If cleanPath is empty after stripping, go to dashboard
      if (!cleanPath || cleanPath.trim() === '') {
        navigate('/cmspanel');
      } else {
        const targetPath = `/cmspanel/${cleanPath}`;
        navigate(targetPath);
      }
    }

    if (window.innerWidth < 1024) {
      setIsOpen(false);
    }
  };

  const toggleGroup = (groupLabel) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupLabel)) {
        next.delete(groupLabel);
      } else {
        next.add(groupLabel);
      }
      return next;
    });
  };

  const groupedMenus = useMemo(() => {
    if (loading) return {};

    const authorizedItems = filterMenuItemsForSidebar({
      items: menuItems,
      hasPermission,
      isPlatformAdmin,
      isFullAccess,
      subscriptionTier: currentTenant?.subscription_tier,
      applyFilters,
      userRole
    });

    const filteredItems = searchQuery
      ? authorizedItems.filter(item =>
        item.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t(`menu.${item.key}`, item.label).toLowerCase().includes(searchQuery.toLowerCase())
      )
      : authorizedItems;
    const groups = {};
    filteredItems.forEach(item => {
      const groupLabel = item.group_label || 'General';
      if (!groups[groupLabel]) {
        groups[groupLabel] = { order: item.group_order || 999, items: [] };
      }
      groups[groupLabel].items.push(item);
    });
    Object.keys(groups).forEach(key => groups[key].items.sort((a, b) => a.order - b.order));
    return groups;
  }, [menuItems, loading, userRole, hasPermission, isPlatformAdmin, isFullAccess, searchQuery, t, applyFilters, currentTenant?.subscription_tier]);

  const sortedGroupKeys = Object.keys(groupedMenus).sort((a, b) =>
    groupedMenus[a].order - groupedMenus[b].order
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (searchQuery) setCollapsedGroups(new Set());
  }, [searchQuery]);

  const sidebarVariants = {
    mobile: {
      x: isOpen ? 0 : -280,
      width: 280,
      position: 'fixed'
    },
    desktop: {
      x: 0,
      width: isOpen ? 280 : 0,
      position: 'relative'
    }
  };

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 1024;

  return (
    <>
      {/* Mobile Overlay */}
      <AnimatePresence>
        {isOpen && isMobile && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsOpen(false)}
            className="fixed inset-0 bg-black/60 z-40 lg:hidden backdrop-blur-sm"
          />
        )}
      </AnimatePresence>

      <motion.aside
        initial={false}
        animate={isMobile ? sidebarVariants.mobile : sidebarVariants.desktop}
        transition={{ duration: 0.3, ease: "easeInOut" }}
        className={cn(
          "inset-y-0 left-0 z-50 overflow-hidden border-r shadow-xl",
          "bg-white/95 dark:bg-slate-950/95 backdrop-blur text-slate-900 dark:text-white",
          "border-slate-200/80 dark:border-slate-800"
        )}
        style={{ whiteSpace: 'nowrap' }}
      >
        <div className="w-[280px] flex flex-col h-full">
          {/* Header */}
          <div className="p-6 border-b border-slate-200/70 dark:border-slate-800/80 flex items-center justify-between bg-white/80 dark:bg-slate-950/70 h-20 shrink-0">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 bg-gradient-to-br from-indigo-500 to-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-500/25">
                <LayoutGrid className="w-5 h-5 text-white" />
              </div>
              <span className="font-bold text-lg tracking-tight">{t('sidebar.title')}</span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="lg:hidden p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Search */}
          <div className="px-4 py-4 border-b border-slate-200/70 dark:border-slate-800/50">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400 dark:text-slate-500" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('sidebar.search_placeholder')}
                className="w-full rounded-md border border-slate-200/70 bg-slate-100/80 py-2 pl-9 pr-4 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition-all dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-100 dark:placeholder:text-slate-500"
              />
            </div>
          </div>

          {/* Menu Items */}
          <div className="flex-1 overflow-y-auto py-4 px-3 custom-scrollbar space-y-6">
            {loading ? (
              <div className="space-y-4 px-2">
                {[1, 2, 3].map(i => (
                  <div key={i} className="space-y-2">
                    <div className="h-4 w-20 bg-slate-800 rounded animate-pulse" />
                    <div className="h-10 w-full bg-slate-800/50 rounded-lg animate-pulse" />
                    <div className="h-10 w-full bg-slate-800/50 rounded-lg animate-pulse" />
                  </div>
                ))}
              </div>
            ) : sortedGroupKeys.length === 0 ? (
              <div className="text-center py-8 text-slate-500 text-sm">
                {t('sidebar.no_items')}
              </div>
            ) : (
              sortedGroupKeys.map(groupLabel => {
                const group = groupedMenus[groupLabel];
                const isCollapsed = collapsedGroups.has(groupLabel);

                return (
                  <div key={groupLabel} className="space-y-1">
                    {/* Group Header */}
                    {groupLabel !== 'General' && (
                      <button
                        onClick={() => toggleGroup(groupLabel)}
                        className="w-full flex items-center justify-between px-3 py-1 text-xs font-semibold text-slate-500 uppercase tracking-wider hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors group"
                      >
                        <span>{groupLabel}</span>
                        {isCollapsed ? (
                          <ChevronRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                        ) : (
                          <ChevronDown className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                        )}
                      </button>
                    )}

                    <AnimatePresence initial={false}>
                      {!isCollapsed && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="space-y-1 overflow-hidden"
                        >
                          {group.items.map((item) => {
                            const Icon = getIconComponent(item.icon);
                            const isActive = item.path === ''
                              ? currentPath === '' || currentPath === 'home'
                              : currentPath === item.path || currentPath.startsWith(item.path + '/');

                            return (
                              <button
                                key={item.id}
                                onClick={() => handleNavigation(item.path)}
                                className={cn(
                                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200",
                                  "group font-medium text-sm relative",
                                  isActive
                                    ? "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300"
                                    : "text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/80 dark:hover:text-white"
                                )}
                              >
                                {isActive && (
                                  <motion.div
                                    layoutId="activeTab"
                                    className="absolute left-0 w-1 h-6 bg-blue-500 rounded-r-full"
                                  />
                                )}
                                <Icon className={cn(
                                  "w-4 h-4 transition-colors shrink-0",
                                  isActive ? "text-blue-600 dark:text-blue-300" : "text-slate-400 dark:text-slate-500 group-hover:text-slate-700 dark:group-hover:text-white"
                                )} />
                                <span className="truncate">{t(`menu.${item.key}`, item.label)}</span>
                              </button>
                            );
                          })}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer Actions */}
          <div className="mt-auto">
            <TenantUsage />
            <div className="p-4 border-t border-slate-200/70 dark:border-slate-800 bg-white/80 dark:bg-slate-950/70 shrink-0">
              <button
                onClick={signOut}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600 dark:text-slate-400 dark:hover:bg-red-950/30 dark:hover:text-red-400 transition-colors text-sm font-medium border border-transparent hover:border-red-200/70 dark:hover:border-red-900/30"
              >
                <LogOut className="w-4 h-4" />
                {t('auth.logout')}
              </button>
            </div>
          </div>
        </div>
      </motion.aside>
    </>
  );
}

export default Sidebar;
