
import { useEffect, useMemo, useState } from 'react';
import { CopyX, Plus, Save, RefreshCw, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { triggerPublicRebuild } from '@/lib/publicRebuild';
import { usePermissions } from '@/contexts/PermissionContext';
import { useTenant } from '@/contexts/TenantContext';
import {
  getModuleByKey,
  getModulesByGroup,
  getPublicModulesForTenant,
  getPublicPortalVariant,
} from '@/lib/publicModuleRegistry';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';
import { SUPPORTED_LOCALES } from '@/lib/i18n';
import MenusOverviewCards from '@/components/dashboard/menus/MenusOverviewCards';
import MenusFiltersBar from '@/components/dashboard/menus/MenusFiltersBar';
import MenusLocaleSelector from '@/components/dashboard/menus/MenusLocaleSelector';
import MenusLocationSelector from '@/components/dashboard/menus/MenusLocationSelector';
import MenusTreePanel from '@/components/dashboard/menus/MenusTreePanel';
import MenuItemDialog from '@/components/dashboard/menus/MenuItemDialog';
import MenuPermissionsDialog from '@/components/dashboard/menus/MenuPermissionsDialog';
import MenuDeleteDialog from '@/components/dashboard/menus/MenuDeleteDialog';

// Available Menu Locations
const MENU_LOCATIONS = [
  { id: 'header', label: 'Primary Header' },
  { id: 'footer', label: 'Footer' },
  { id: 'public_sidebar', label: 'Public Sidebar' },
  { id: 'mobile_menu', label: 'Mobile Menu' }
];

const normalizeMenuUrl = (value) => {
  const trimmed = (value || '').trim();

  if (!trimmed) return '';
  if (/^(https?:|mailto:|tel:|#)/i.test(trimmed)) return trimmed;
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
};

const createMenuSlug = (label, url = '') => {
  const source = (label || url || 'menu-item').toLowerCase();
  return source
    .replace(/https?:\/\//g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'menu-item';
};

const buildMenuTree = (items) => {
  const menuMap = {};
  const roots = [];

  items.forEach((item) => {
    menuMap[item.id] = { ...item, children: [] };
  });

  items.forEach((item) => {
    if (item.parent_id && menuMap[item.parent_id]) {
      menuMap[item.parent_id].children.push(menuMap[item.id]);
    } else {
      roots.push(menuMap[item.id]);
    }
  });

  roots.sort((a, b) => (a.order || 0) - (b.order || 0));
  Object.values(menuMap).forEach((node) => {
    node.children.sort((a, b) => (a.order || 0) - (b.order || 0));
  });

  return roots;
};

const filterMenuTree = (items, searchQuery, visibilityFilter) => {
  const searchValue = searchQuery.trim().toLowerCase();

  return items.reduce((acc, item) => {
    const filteredChildren = item.children?.length
      ? filterMenuTree(item.children, searchQuery, visibilityFilter)
      : [];

    const matchesSearch = !searchValue || [item.label, item.url, item.name]
      .filter(Boolean)
      .some((value) => value.toLowerCase().includes(searchValue));

    const matchesVisibility = visibilityFilter === 'all'
      || (visibilityFilter === 'public' && item.is_public)
      || (visibilityFilter === 'restricted' && !item.is_public);

    if ((matchesSearch && matchesVisibility) || filteredChildren.length > 0) {
      acc.push({ ...item, children: filteredChildren });
    }

    return acc;
  }, []);
};

const getDuplicateMenuIds = (items) => {
  const signatures = new Map();
  const duplicateIds = new Set();

  items.forEach((item) => {
    const signature = [
      item.parent_id || 'root',
      (item.label || '').trim().toLowerCase(),
      (item.url || '').trim().toLowerCase(),
    ].join('::');

    if (!signatures.has(signature)) {
      signatures.set(signature, item.id);
      return;
    }

    duplicateIds.add(item.id);
  });

  return duplicateIds;
};

function MenusManager() {
  const { toast } = useToast();
  const { hasPermission, isPlatformAdmin } = usePermissions();
  const { currentTenant } = useTenant();

  // Data State
  const [menus, setMenus] = useState([]); // This will store the TREE structure
  const [flatMenus, setFlatMenus] = useState([]); // Store flat list for parent selection
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentLocation, setCurrentLocation] = useState('header');
  const [currentLocale, setCurrentLocale] = useState(SUPPORTED_LOCALES[0].code);

  // Editor State
  const [isEditing, setIsEditing] = useState(false);
  const [editingMenu, setEditingMenu] = useState(null);
  const [menuFormData, setMenuFormData] = useState({});

  // Permission Editor State
  const [isPermEditorOpen, setIsPermEditorOpen] = useState(false);
  const [selectedMenuPerms, setSelectedMenuPerms] = useState(null);
  const [menuPermissions, setMenuPermissions] = useState({});
  const [menuToDelete, setMenuToDelete] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [selectedModule, setSelectedModule] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [visibilityFilter, setVisibilityFilter] = useState('all');
  const [activeModuleSlugs, setActiveModuleSlugs] = useState([]);

  const canView = hasPermission('tenant.menu.read');
  const canCreate = hasPermission('tenant.menu.create');
  const canEdit = hasPermission('tenant.menu.update');
  const canDelete = hasPermission('tenant.menu.delete');

  const [pages, setPages] = useState([]);

  useEffect(() => {
    if (canView) {
      fetchMenus();
      fetchRoles();
      fetchPages();
      fetchTenantModules();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, currentLocation, currentLocale, currentTenant?.id]); // Re-fetch when location or tenant changes

  const fetchTenantModules = async () => {
    if (!currentTenant?.id) {
      setActiveModuleSlugs([]);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('modules')
        .select('slug')
        .eq('tenant_id', currentTenant.id)
        .eq('status', 'active');

      if (error) throw error;
      setActiveModuleSlugs((data || []).map((module) => module.slug));
    } catch (error) {
      console.error(error);
      setActiveModuleSlugs([]);
    }
  };

  const fetchPages = async () => {
    try {
      let q = supabase.from('pages').select('id, title, slug, status').neq('status', 'archived');
      if (currentTenant?.id) q = q.eq('tenant_id', currentTenant.id);

      const { data, error } = await q;
      if (!error) setPages(data || []);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchMenus = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('menus')
        .select('*, tenant:tenants(name)')
        .is('deleted_at', null)
        .eq('location', currentLocation)
        .eq('locale', currentLocale)
        .order('order', { ascending: true });

      if (currentTenant?.id) {
        query = query.eq('tenant_id', currentTenant.id);
      }

      const { data, error } = await query;

      if (error) throw error;

      setFlatMenus(data || []);
      const tree = buildMenuTree(data || []);
      setMenus(tree);
    } catch (err) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Error fetching menus', description: err.message });
    } finally {
      setLoading(false);
    }
  };

  const fetchRoles = async () => {
    if (!currentTenant?.id && !isPlatformAdmin) {
      setRoles([]);
      return;
    }

    let query = supabase
      .from('roles')
      .select('id, name, tenant_id')
      .is('deleted_at', null)
      .order('name');

    if (currentTenant?.id) {
      query = query.eq('tenant_id', currentTenant.id);
    } else {
      query = query.is('tenant_id', null);
    }

    const { data } = await query;
    setRoles(data || []);
  };

  const handleReorder = (newOrder) => {
    setMenus(newOrder);
  };

  const handleChildReorder = (parentId, newChildrenOrder) => {
    const updateRecursive = (items) => {
      return items.map(item => {
        if (item.id === parentId) {
          return { ...item, children: newChildrenOrder };
        }
        if (item.children) {
          return { ...item, children: updateRecursive(item.children) };
        }
        return item;
      });
    };
    setMenus(updateRecursive(menus));
  };

  const duplicateMenuIds = useMemo(() => getDuplicateMenuIds(flatMenus), [flatMenus]);
  const duplicateCount = duplicateMenuIds.size;
  const portalVariant = getPublicPortalVariant(currentTenant);
  const portalVariantLabel = portalVariant === 'smandapbun' ? 'Smandapbun portal' : 'Primary portal';
  const availableModules = useMemo(
    () => getPublicModulesForTenant(currentTenant, activeModuleSlugs),
    [currentTenant, activeModuleSlugs],
  );
  const moduleGroups = useMemo(
    () => getModulesByGroup(currentTenant, activeModuleSlugs),
    [currentTenant, activeModuleSlugs],
  );
  const hasActiveFilters = Boolean(searchQuery.trim()) || visibilityFilter !== 'all';
  const displayedMenus = useMemo(
    () => filterMenuTree(menus, searchQuery, visibilityFilter),
    [menus, searchQuery, visibilityFilter],
  );

  const saveOrder = async () => {
    try {
      // Flatten the current tree state back into a list of updates
      const updates = [];

      const processNode = (node, index, parentId = null) => {
        updates.push({ id: node.id, order: index, parent_id: parentId });
        if (node.children && node.children.length > 0) {
          node.children.forEach((child, childIndex) => processNode(child, childIndex, node.id));
        }
      };

      menus.forEach((menu, index) => processNode(menu, index));

      // Use RPC to avoid 400 errors with partial upserts
      const { error } = await supabase.rpc('update_menu_order', { payload: updates });

      if (error) throw error;

      toast({ title: 'Menu order saved', description: 'The navigation structure has been updated.' });
    } catch (err) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Failed to save order', description: err.message });
    }
  };

  const handleEdit = (menu) => {
    setEditingMenu(menu);
    setSelectedModule(menu?.name || '');
    if (menu) {
      // Ensure boolean values are properly set when editing existing menu
      setMenuFormData({
        ...menu,
        slug: menu.slug || createMenuSlug(menu.label, menu.url),
        is_active: menu.is_active === true,
        is_public: menu.is_public === true,
        page_id: menu.page_id || '', // Handle page_id
        location: menu.location || currentLocation,
        locale: menu.locale || currentLocale
      });
    } else {
      // Default values for new menu
      setMenuFormData({
        label: '',
        url: '',
        name: '',
        slug: '',
        is_public: true,
        is_active: true,
        parent_id: null,
        page_id: '',
        location: currentLocation,
        locale: currentLocale
      });
    }
    setIsEditing(true);
  };

  // Handle Page Selection
  const handlePageSelect = (pageId) => {
    const page = pages.find(p => p.id === pageId);
    if (page) {
      setMenuFormData(prev => ({
        ...prev,
        page_id: pageId,
        url: page.slug.startsWith('/') ? page.slug : `/${page.slug}`,
        label: prev.label || page.title,
        slug: prev.slug || createMenuSlug(page.title, page.slug),
      }));
    } else {
      // Clear page association
      setMenuFormData(prev => ({ ...prev, page_id: null }));
    }
  };

  const handleSaveMenu = async (e) => {
    e.preventDefault();

    const normalizedUrl = normalizeMenuUrl(menuFormData.url);
    const resolvedSlug = menuFormData.slug || createMenuSlug(menuFormData.label, normalizedUrl);

    const payload = {
      label: menuFormData.label,
      name: menuFormData.name || resolvedSlug.replace(/-/g, '_'),
      slug: resolvedSlug,
      url: normalizedUrl,
      parent_id: menuFormData.parent_id || null,
      page_id: menuFormData.page_id || null,
      location: menuFormData.location || currentLocation,
      locale: currentLocale,
      is_public: menuFormData.is_public,
      is_active: menuFormData.is_active,
      updated_at: new Date().toISOString()
    };

    try {
      let error;
      if (editingMenu) {
        const { error: updateError } = await supabase
          .from('menus')
          .update(payload)
          .eq('id', editingMenu.id);
        error = updateError;
      } else {
        // Get max order for new item
        payload.order = Math.max(0, ...flatMenus.map((item) => item.order || 0)) + 10;
        payload.tenant_id = currentTenant?.id; // Set tenant context
        const { error: insertError } = await supabase
          .from('menus')
          .insert(payload);
        error = insertError;
      }

      if (error) throw error;

      try {
        await triggerPublicRebuild({
          tenantId: currentTenant?.id,
          resource: 'menus',
          action: editingMenu ? 'update' : 'create',
        });
      } catch (rebuildError) {
        console.warn('Public rebuild trigger failed:', rebuildError);
      }

      toast({ title: 'Success', description: 'Menu item saved successfully' });
      setIsEditing(false);
      fetchMenus();
    } catch (err) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Error saving menu', description: err.message });
    }
  };

  const requestDelete = (menu) => {
    setMenuToDelete(menu);
  };

  const handleConfirmDelete = async () => {
    if (!menuToDelete) {
      return;
    }

    const { error } = await supabase.rpc('soft_delete_menu', { p_menu_id: menuToDelete.id });

    if (error) {
      toast({ variant: 'destructive', title: 'Error deleting menu' });
    } else {
      try {
        await triggerPublicRebuild({ tenantId: currentTenant?.id, resource: 'menus', action: 'delete' });
      } catch (rebuildError) {
        console.warn('Public rebuild trigger failed:', rebuildError);
      }
      toast({ title: 'Menu deleted' });
      fetchMenus();
    }

    setMenuToDelete(null);
  };

  const openPermissions = async (menu) => {
    setSelectedMenuPerms(menu);
    // Fetch existing perms
    const { data } = await supabase
      .from('menu_permissions')
      .select('role_id, can_view')
      .eq('menu_id', menu.id);

    const permsMap = {};
    roles.forEach(r => permsMap[r.id] = false); // Default false

    if (data) {
      data.forEach(p => {
        if (p.can_view) permsMap[p.role_id] = true;
      });
    }
    setMenuPermissions(permsMap);
    setIsPermEditorOpen(true);
  };

  const savePermissions = async () => {
    const permissionsPayload = Object.entries(menuPermissions).map(([roleId, canView]) => ({
      role_id: roleId,
      can_view: canView,
    }));

    const { error } = await supabase.rpc('save_menu_permissions', {
      p_menu_id: selectedMenuPerms.id,
      p_permissions: permissionsPayload,
    });

    if (error) {
      toast({ variant: 'destructive', title: 'Failed to save permissions' });
    } else {
      toast({ title: 'Permissions updated' });
      setIsPermEditorOpen(false);
    }
  };

  // Sync from public module registry
  const syncFromModules = async () => {
    if (!currentTenant?.id) {
      toast({ variant: 'destructive', title: 'No tenant selected' });
      return;
    }
    setSyncing(true);
    try {
      const existingKeys = new Set(flatMenus.map((menu) => [
        (menu.label || '').trim().toLowerCase(),
        (menu.url || '').trim().toLowerCase(),
      ].join('::')));
      const modulesToAdd = availableModules.filter((module) => {
        const signature = [module.label.trim().toLowerCase(), module.url.trim().toLowerCase()].join('::');
        return !existingKeys.has(signature);
      });

      if (modulesToAdd.length === 0) {
        toast({ title: 'All modules already exist', description: 'No new items to add' });
        setSyncing(false);
        return;
      }

      const maxOrder = Math.max(0, ...flatMenus.map(m => m.order || 0));
      const newItems = modulesToAdd.map((mod, idx) => ({
        label: mod.label,
        name: mod.key,
        slug: mod.key,
        url: mod.url,
        icon: mod.icon,
        location: currentLocation,
        locale: currentLocale,
        parent_id: null,
        order: maxOrder + ((idx + 1) * 10),
        is_active: true,
        is_public: true,
        tenant_id: currentTenant.id,
        created_at: new Date().toISOString(),
      }));

      const { error } = await supabase.from('menus').insert(newItems);
      if (error) throw error;

      try {
        await triggerPublicRebuild({ tenantId: currentTenant?.id, resource: 'menus', action: 'create' });
      } catch (rebuildError) {
        console.warn('Public rebuild trigger failed:', rebuildError);
      }

      toast({ title: 'Sync complete', description: `Added ${newItems.length} menu items` });
      fetchMenus();
    } catch (err) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Sync failed', description: err.message });
    } finally {
      setSyncing(false);
    }
  };

  // Handle module picker selection
  const handleModuleSelect = (moduleKey) => {
    setSelectedModule(moduleKey);
    if (moduleKey) {
      const mod = availableModules.find((module) => module.key === moduleKey) || getModuleByKey(moduleKey);
      if (mod) {
        setMenuFormData(prev => ({
          ...prev,
          label: mod.label,
          name: mod.key,
          slug: mod.key,
          url: mod.url,
        }));
      }
    }
  };

  const dedupeMenus = async () => {
    if (duplicateMenuIds.size === 0) {
      return;
    }

    try {
      await Promise.all(Array.from(duplicateMenuIds).map((id) => (
        supabase.rpc('soft_delete_menu', { p_menu_id: id })
      )));

      try {
        await triggerPublicRebuild({ tenantId: currentTenant?.id, resource: 'menus', action: 'delete' });
      } catch (rebuildError) {
        console.warn('Public rebuild trigger failed:', rebuildError);
      }

      toast({ title: 'Duplicates removed', description: 'Repeated links were moved out of the active menu scope.' });
      fetchMenus();
    } catch (error) {
      console.error(error);
      toast({ variant: 'destructive', title: 'Failed to clean duplicates', description: error.message });
    }
  };

  if (!canView) {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center rounded-2xl border border-border/60 bg-card/70 p-8 text-center text-muted-foreground shadow-sm">
        Access Denied
      </div>
    );
  }

  return (
    <AdminPageLayout requiredPermission="tenant.menu.read">
      <PageHeader
        title="Menu Management"
        description="Configure public navigation structure for headers, footers, and sidebars"
        icon={Menu}
        breadcrumbs={[{ label: 'Menus', icon: Menu }]}
        actions={(
          <div className="flex gap-3 flex-wrap">
            {canCreate && (
              <Button onClick={syncFromModules} variant="outline" disabled={syncing} className="h-10 rounded-xl border-border/70 bg-background/80 px-3 text-muted-foreground shadow-sm hover:bg-accent/70 hover:text-foreground">
                <RefreshCw className={`w-4 h-4 mr-2 ${syncing ? 'animate-spin' : ''}`} /> Sync Modules
              </Button>
            )}
            {duplicateCount > 0 && canDelete && (
              <Button onClick={dedupeMenus} variant="outline" className="h-10 rounded-xl border-border/70 bg-background/80 px-3 text-muted-foreground shadow-sm hover:bg-accent/70 hover:text-foreground">
                <CopyX className="w-4 h-4 mr-2" /> Clean Duplicates
              </Button>
            )}
            <Button onClick={saveOrder} variant="outline" disabled={hasActiveFilters} className="h-10 rounded-xl border-border/70 bg-background/80 px-3 text-muted-foreground shadow-sm hover:bg-accent/70 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60">
              <Save className="w-4 h-4 mr-2" /> Save Order
            </Button>
            {canCreate && (
              <Button onClick={() => handleEdit(null)} className="h-10 rounded-xl bg-primary px-4 text-primary-foreground shadow-sm hover:opacity-95">
                <Plus className="w-4 h-4 mr-2" /> Add Item
              </Button>
            )}
          </div>
        )}
      />

      <div className="space-y-6">
          <MenusOverviewCards
            flatMenus={flatMenus}
            rolesCount={roles.length}
            currentLocationLabel={MENU_LOCATIONS.find((location) => location.id === currentLocation)?.label}
            portalVariantLabel={portalVariantLabel}
            duplicateCount={duplicateCount}
          />

          <MenusFiltersBar
            searchQuery={searchQuery}
            onChangeSearch={setSearchQuery}
            visibilityFilter={visibilityFilter}
            onChangeVisibility={setVisibilityFilter}
            duplicateCount={duplicateCount}
          />

        <MenusLocaleSelector
          locales={SUPPORTED_LOCALES}
          currentLocale={currentLocale}
          onChangeLocale={setCurrentLocale}
        />

        <MenusLocationSelector
          locations={MENU_LOCATIONS}
          currentLocation={currentLocation}
          onChangeLocation={setCurrentLocation}
        />

        <MenusTreePanel
          loading={loading}
          menus={displayedMenus}
          hasActiveFilters={hasActiveFilters}
          canEdit={canEdit}
          canDelete={canDelete}
          onEdit={handleEdit}
          onRequestDelete={requestDelete}
          onPerms={openPermissions}
          onReorder={handleReorder}
          onChildReorder={handleChildReorder}
          isPlatformAdmin={isPlatformAdmin}
        />

        <MenuItemDialog
          open={isEditing}
          onOpenChange={setIsEditing}
          editingMenu={editingMenu}
          currentLocation={currentLocation}
          menuLocations={MENU_LOCATIONS}
          menuFormData={menuFormData}
          setMenuFormData={setMenuFormData}
          selectedModule={selectedModule}
          onModuleSelect={handleModuleSelect}
          pages={pages}
          onPageSelect={handlePageSelect}
          flatMenus={flatMenus}
          moduleGroups={moduleGroups}
          onSave={handleSaveMenu}
        />

        <MenuPermissionsDialog
          open={isPermEditorOpen}
          onOpenChange={setIsPermEditorOpen}
          selectedMenu={selectedMenuPerms}
          roles={roles}
          menuPermissions={menuPermissions}
          setMenuPermissions={setMenuPermissions}
          onSave={savePermissions}
        />

        <MenuDeleteDialog
          open={Boolean(menuToDelete)}
          onOpenChange={(open) => !open && setMenuToDelete(null)}
          menu={menuToDelete}
          onConfirm={handleConfirmDelete}
        />
      </div>
    </AdminPageLayout>
  );
}

export default MenusManager;
