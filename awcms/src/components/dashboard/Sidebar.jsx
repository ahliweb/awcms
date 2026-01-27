
import React, { useState, useMemo, useEffect } from 'react';
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
import { checkTierAccess } from '@/lib/tierFeatures';

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
    // Debug logging - remove after fixing
    console.log('[Sidebar] handleNavigation called with path:', path);

    // Handle empty, null, undefined, or root path
    if (!path || path === '' || path === '/' || path === 'home') {
      console.log('[Sidebar] Navigating to dashboard home');
      navigate('/cmspanel');
    }
    // Prevent external URLs (http, https, mailto, etc.)
    else if (path.includes('://') || path.startsWith('mailto:') || path.startsWith('tel:')) {
      console.warn('[Sidebar] External URL detected, ignoring:', path);
      return; // Don't navigate to external URLs
    }
    // Handle path that's just a slash followed by nothing useful
    else if (path.trim() === '/' || path.trim() === '') {
      console.log('[Sidebar] Empty/root path, navigating to dashboard home');
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
        console.log('[Sidebar] Path became empty after cleanup, navigating to dashboard home');
        navigate('/cmspanel');
      } else {
        const targetPath = `/cmspanel/${cleanPath}`;
        console.log('[Sidebar] Navigating to:', targetPath);
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
    // DEBUG: Log initial count
    console.log('[Sidebar] Menu Items Count:', menuItems.length);
    console.log('[Sidebar] User Role:', userRole);
    console.log('[Sidebar] Current Tenant Tier:', currentTenant?.subscription_tier);

    const authorizedItems = menuItems.filter(item => {
      if (!item.is_visible) {
        if (item.key === 'sidebar_manager') console.log('[Sidebar] Hidden: is_visible false');
        return false;
      }
      if (item.permission === 'super_admin_only') return isFullAccess || isPlatformAdmin;
      if (item.permission === 'platform_admin_only') return isPlatformAdmin;

      // Check Subscription Tier
      if (!checkTierAccess(currentTenant?.subscription_tier, item.key)) {
        if (item.key === 'sidebar_manager') console.log('[Sidebar] Hidden: Tier Restriction', currentTenant?.subscription_tier, item.key);
        return false;
      }

      if (item.permission) {
        const hasPerm = hasPermission(item.permission);
        if (item.key === 'sidebar_manager') console.log('[Sidebar] Permission Check:', item.permission, hasPerm);
        return hasPerm;
      }
      return true;
    });

    // HOOK: Allow plugins to modify the menu items dynamically (applyFilters from top-level hook)
    const filteredByPlugins = applyFilters('admin_sidebar_menu', authorizedItems, { userRole, hasPermission });

    const filteredItems = searchQuery
      ? filteredByPlugins.filter(item =>
        item.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t(`menu.${item.key}`, item.label).toLowerCase().includes(searchQuery.toLowerCase())
      )
      : filteredByPlugins;
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
          "inset-y-0 left-0 z-50 bg-slate-900 shadow-xl overflow-hidden",
          "flex flex-col border-r border-slate-800 text-white"
        )}
        style={{ whiteSpace: 'nowrap' }}
      >
        <div className="w-[280px] flex flex-col h-full">
          {/* Header */}
          <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-950/50 h-20 shrink-0">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-900/20">
                <LayoutGrid className="w-5 h-5 text-white" />
              </div>
              <span className="font-bold text-lg tracking-tight">{t('sidebar.title')}</span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="lg:hidden p-2 hover:bg-slate-800 rounded-lg transition-colors text-slate-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Search */}
          <div className="px-4 py-4 border-b border-slate-800/50">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('sidebar.search_placeholder')}
                className="w-full rounded-md py-2 pl-9 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 transition-all"
                style={{
                  backgroundColor: 'rgba(2, 6, 23, 0.5)',
                  borderColor: '#1e293b',
                  color: '#e2e8f0'
                }}
              />
            </div>
          </div>

          {/* DEBUG INFO - REMOVE AFTER FIXING */}
          <div className="p-2 bg-red-900/50 text-[10px] text-white break-all">
            <p>Role: {userRole}</p>
            <p>Tier: {currentTenant?.subscription_tier || 'undefined'}</p>
            <p>Perm: {hasPermission('platform.sidebar.read') ? 'YES' : 'NO'}</p>
            <p>Menu Items: {menuItems?.length}</p>
            <p>SidebarMgr: {menuItems?.find(i => i.key === 'sidebar_manager') ? 'FOUND' : 'MISSING'}</p>
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
                        className="w-full flex items-center justify-between px-3 py-1 text-xs font-semibold text-slate-500 uppercase tracking-wider hover:text-slate-300 transition-colors group"
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
                                    ? "bg-blue-600/10 text-blue-400"
                                    : "text-slate-400 hover:bg-slate-800 hover:text-white"
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
                                  isActive ? "text-blue-400" : "text-slate-500 group-hover:text-white"
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
            <div className="p-4 border-t border-slate-800 bg-slate-950/50 shrink-0">
              <button
                onClick={signOut}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-slate-400 hover:bg-red-950/30 hover:text-red-400 transition-colors text-sm font-medium border border-transparent hover:border-red-900/30"
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
