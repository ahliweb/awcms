import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Settings2, ShieldAlert } from 'lucide-react';
import { useAdminMenu } from '@/hooks/useAdminMenu';
import { supabase } from '@/lib/customSupabaseClient';
import { usePermissions } from '@/contexts/PermissionContext';
import { useTenant } from '@/contexts/TenantContext';
import { usePlugins } from '@/contexts/PluginContext';
import { useSearch } from '@/hooks/useSearch';
import { filterMenuItemsForSidebar, resolveGroupMeta } from '@/lib/adminMenuUtils';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/ui/use-toast';
import useSplatSegments from '@/hooks/useSplatSegments';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';
import SidebarMenuHeaderActions from '@/components/dashboard/sidebar-menu/SidebarMenuHeaderActions';
import SidebarMenuItemsTab from '@/components/dashboard/sidebar-menu/SidebarMenuItemsTab';
import SidebarMenuGroupsTab from '@/components/dashboard/sidebar-menu/SidebarMenuGroupsTab';
import SidebarMenuEditItemDialog from '@/components/dashboard/sidebar-menu/SidebarMenuEditItemDialog';
import SidebarMenuEditGroupDialog from '@/components/dashboard/sidebar-menu/SidebarMenuEditGroupDialog';
import SidebarMenuCreateGroupDialog from '@/components/dashboard/sidebar-menu/SidebarMenuCreateGroupDialog';

function SidebarMenuManager() {
  const { t } = useTranslation();
  const {
    menuItems,
    loading,
    updateMenuOrder,
    toggleVisibility,
    updateMenuItem,
    updateGroup,
    fetchMenu,
  } = useAdminMenu();
  const {
    hasPermission,
    hasAnyPermission,
    isPlatformAdmin,
    isFullAccess,
    isTenantAdmin,
    userRole,
    loading: permsLoading,
  } = usePermissions();
  const { currentTenant } = useTenant();
  const { applyFilters } = usePlugins();
  const { toast } = useToast();
  const navigate = useNavigate();
  const segments = useSplatSegments();

  const tabValues = ['items', 'groups'];
  const hasTabSegment = tabValues.includes(segments[0]);
  const activeTab = hasTabSegment ? segments[0] : 'items';
  const hasExtraSegment = segments.length > 1;

  const {
    query,
    setQuery,
    debouncedQuery,
    isValid: isSearchValid,
    message: searchMessage,
    loading: searchLoading,
    minLength,
    clearSearch,
  } = useSearch({ context: 'admin' });

  const [items, setItems] = useState([]);

  const [groups, setGroups] = useState([]);
  const [editingGroup, setEditingGroup] = useState(null);
  const [groupEditForm, setGroupEditForm] = useState({ label: '', order: 0 });
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const [showNewGroupDialog, setShowNewGroupDialog] = useState(false);
  const [newGroupForm, setNewGroupForm] = useState({ label: '', order: 100 });

  const [editingItem, setEditingItem] = useState(null);
  const [editForm, setEditForm] = useState({
    label: '',
    group_label: 'General',
    group_order: 0,
  });

  const canView = hasPermission('platform.sidebar.read');
  const canEdit = hasPermission('platform.sidebar.update');
  const isSuperAdmin = isPlatformAdmin || isFullAccess;
  const canManage = canEdit || isSuperAdmin;

  useEffect(() => {
    if (segments.length > 0 && !hasTabSegment) {
      navigate('/cmspanel/admin-navigation', { replace: true });
      return;
    }

    if (hasTabSegment && hasExtraSegment) {
      const basePath = activeTab === 'items'
        ? '/cmspanel/admin-navigation'
        : `/cmspanel/admin-navigation/${activeTab}`;
      navigate(basePath, { replace: true });
    }
  }, [segments, hasTabSegment, hasExtraSegment, activeTab, navigate]);

  // Sidebar Manager shows ALL items regardless of user permissions
  // This allows admins to manage visibility for all modules
  const visibleItems = useMemo(() => {
    if (isSuperAdmin || canManage) {
      // Admins see ALL items (no permission filtering)
      return menuItems.map((item) => {
        const { label: groupLabel, order: groupOrder } = resolveGroupMeta(
          item.group_label,
          item.group_order
        );
        return {
          ...item,
          group_label: groupLabel,
          group_order: groupOrder
        };
      });
    }
    // Non-admins use permission filtering
    return filterMenuItemsForSidebar({
      items: menuItems,
      hasPermission,
      hasAnyPermission,
      isPlatformAdmin,
      isFullAccess,
      isTenantAdmin,
      subscriptionTier: currentTenant?.subscription_tier,
      applyFilters,
      userRole,
    });
  }, [
    menuItems,
    isSuperAdmin,
    canManage,
    hasPermission,
    hasAnyPermission,
    isPlatformAdmin,
    isFullAccess,
    isTenantAdmin,
    currentTenant?.subscription_tier,
    applyFilters,
    userRole,
  ]);

  useEffect(() => {
    const sourceItems = visibleItems;

    const uniqueGroups = [];
    const seen = new Set();
    const groupSources = new Map();

    sourceItems.forEach((item) => {
      const sources = groupSources.get(item.group_label) || new Set();
      if (item.source === 'extension') {
        sources.add('extension');
      } else if (item.source === 'plugin') {
        sources.add('plugin');
      } else {
        sources.add('core');
      }
      groupSources.set(item.group_label, sources);
    });

    sourceItems.forEach((item) => {
      if (!seen.has(item.group_label)) {
        seen.add(item.group_label);
        const sources = groupSources.get(item.group_label) || new Set();
        const isExtension = sources.size === 1 && sources.has('extension');
        const isPlugin = sources.size === 1 && sources.has('plugin');
        uniqueGroups.push({
          id: item.group_label,
          label: item.group_label,
          order: item.group_order || 999,
          isExtension,
          isPlugin,
        });
      }
    });

    uniqueGroups.sort((a, b) => a.order - b.order);
    setGroups(uniqueGroups);
    setItems(sourceItems);
  }, [visibleItems]);

  const handleGroupReorder = (newOrder) => {
    if (!canManage) return;
    setGroups(newOrder);
    setHasChanges(true);
  };

  const handleSaveGroupOrder = async () => {
    if (!canManage) return;

    setIsSaving(true);
    try {
      for (let index = 0; index < groups.length; index += 1) {
        const group = groups[index];
        await updateGroup(group.label, { newOrder: (index + 1) * 10 });
      }

      toast({
        title: t('common.success'),
        description: t('sidebar_manager.toast.group_order_updated'),
      });
      setHasChanges(false);
      fetchMenu();
    } catch {
      toast({
        variant: 'destructive',
        title: t('common.error'),
        description: t('sidebar_manager.toast.error_save_group'),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditGroup = (group) => {
    setEditingGroup(group);
    setGroupEditForm({ label: group.label, order: group.order });
  };

  const saveGroupEdit = async () => {
    if (!editingGroup) return;

    try {
      await updateGroup(editingGroup.label, {
        newLabel: groupEditForm.label,
        newOrder: parseInt(groupEditForm.order, 10),
      });
      setEditingGroup(null);
      toast({ title: t('common.success'), description: t('sidebar_manager.toast.group_updated') });
      fetchMenu();
    } catch {
      toast({
        variant: 'destructive',
        title: t('common.error'),
        description: t('sidebar_manager.toast.error_update_group'),
      });
    }
  };

  const handleCreateGroup = async () => {
    if (!newGroupForm.label.trim()) return;

    try {
      const groupKey = newGroupForm.label.toLowerCase().replace(/\s+/g, '_');

      const { error } = await supabase
        .from('admin_menus')
        .insert({
          key: `group_placeholder_${groupKey}`,
          label: `[${newGroupForm.label} Placeholder]`,
          path: '',
          icon: 'FolderOpen',
          permission: 'super_admin_only',
          group_label: newGroupForm.label.toUpperCase(),
          group_order: parseInt(newGroupForm.order, 10) || 100,
          order: 9999,
          is_visible: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

      if (error) throw error;

      setShowNewGroupDialog(false);
      toast({
        title: t('common.success'),
        description: t('sidebar_manager.toast.group_created', { name: newGroupForm.label }),
      });
      fetchMenu();
    } catch (error) {
      console.error('Error creating group:', error);
      toast({
        variant: 'destructive',
        title: t('common.error'),
        description: t('sidebar_manager.toast.error_create_group'),
      });
    }
  };

  const handleOpenNewGroup = () => {
    setNewGroupForm({ label: '', order: (groups.length + 1) * 10 });
    setShowNewGroupDialog(true);
  };

  const handleReorder = (newOrder) => {
    if (!canManage) return;
    setItems(newOrder);
    setHasChanges(true);
  };

  const handleSaveOrder = async () => {
    if (!canManage) {
      toast({
        variant: 'destructive',
        title: t('sidebar_manager.toast.permission_denied'),
        description: t('sidebar_manager.toast.permission_desc'),
      });
      return;
    }

    setIsSaving(true);
    try {
      await updateMenuOrder(items);
      setHasChanges(false);
      toast({ title: t('common.success'), description: t('sidebar_manager.toast.menu_order_updated') });
    } catch {
      toast({
        variant: 'destructive',
        title: t('common.error'),
        description: t('sidebar_manager.toast.error_save_order'),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleVisibility = async (item) => {
    if (!canManage) {
      toast({
        variant: 'destructive',
        title: t('sidebar_manager.toast.permission_denied'),
        description: t('sidebar_manager.toast.permission_desc'),
      });
      return;
    }

    try {
      await toggleVisibility(item.id, item.is_visible);
      setItems((prev) => prev.map((menuItem) => (
        menuItem.id === item.id
          ? { ...menuItem, is_visible: !menuItem.is_visible }
          : menuItem
      )));
      toast({
        title: item.is_visible ? t('sidebar_manager.hidden') : t('sidebar_manager.visible'),
        description: t('sidebar_manager.toast.visibility_updated', {
          status: item.is_visible ? t('sidebar_manager.hidden') : t('sidebar_manager.visible'),
        }),
      });
    } catch {
      toast({
        variant: 'destructive',
        title: t('common.error'),
        description: t('sidebar_manager.toast.error_visibility'),
      });
    }
  };

  const handleEdit = (item) => {
    if (!canManage) {
      toast({
        variant: 'destructive',
        title: t('sidebar_manager.toast.permission_denied'),
        description: t('sidebar_manager.toast.permission_desc'),
      });
      return;
    }

    setEditingItem(item);
    setEditForm({
      label: item.label,
      group_label: item.group_label || 'General',
      group_order: item.group_order || 0,
    });
  };

  const saveEdit = async () => {
    if (!editingItem) return;

    try {
      await updateMenuItem(editingItem.id, {
        label: editForm.label,
        group_label: editForm.group_label,
        group_order: parseInt(editForm.group_order, 10) || 0,
      });

      setItems((prev) => prev.map((item) => (
        item.id === editingItem.id
          ? {
            ...item,
            label: editForm.label,
            group_label: editForm.group_label,
            group_order: parseInt(editForm.group_order, 10) || 0,
          }
          : item
      )));

      setEditingItem(null);
      toast({ title: t('common.success'), description: t('sidebar_manager.toast.item_updated') });
    } catch {
      toast({
        variant: 'destructive',
        title: t('common.error'),
        description: t('sidebar_manager.toast.error_update_item'),
      });
    }
  };

  const effectiveQuery = isSearchValid ? debouncedQuery : '';
  const filteredItems = items.filter((item) => (
    !effectiveQuery
      || item.label.toLowerCase().includes(effectiveQuery.toLowerCase())
      || item.key.toLowerCase().includes(effectiveQuery.toLowerCase())
      || (item.group_label || '').toLowerCase().includes(effectiveQuery.toLowerCase())
  ));

  const existingGroups = [...new Set(items.map((item) => item.group_label || 'General'))].sort();

  if (permsLoading) {
    return <div className="p-8 text-center text-slate-500">Checking permissions...</div>;
  }

  if (!canView && !isSuperAdmin) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center rounded-xl border border-border bg-card p-12 text-center">
        <div className="mb-4 rounded-full bg-destructive/10 p-4">
          <ShieldAlert className="h-12 w-12 text-destructive" />
        </div>
        <h3 className="text-xl font-bold text-foreground">{t('sidebar_manager.access_restricted.title')}</h3>
        <p className="mt-2 text-muted-foreground">{t('sidebar_manager.access_restricted.desc')}</p>
      </div>
    );
  }

  return (
		<AdminPageLayout requiredPermission="platform.sidebar.read" className="space-y-6">
      <Helmet>
        <title>{t('sidebar_manager.title')} - CMS</title>
      </Helmet>

      <PageHeader
        title={t('sidebar_manager.title')}
        description={t('sidebar_manager.subtitle')}
        icon={Settings2}
        breadcrumbs={[{ label: t('sidebar_manager.breadcrumbs'), icon: Settings2 }]}
        actions={(
          <SidebarMenuHeaderActions
            t={t}
            fetchMenu={fetchMenu}
            loading={loading}
            hasChanges={hasChanges}
            handleSaveOrder={handleSaveOrder}
            isSaving={isSaving}
          />
        )}
      />

			<Tabs
				value={activeTab}
				onValueChange={(value) => {
					navigate(value === 'items' ? '/cmspanel/admin-navigation' : `/cmspanel/admin-navigation/${value}`);
				}}
				className="w-full"
			>
				<div className="flex items-center justify-between">
					<TabsList>
						<TabsTrigger value="items">{t('sidebar_manager.tabs.items')}</TabsTrigger>
						<TabsTrigger value="groups">{t('sidebar_manager.tabs.groups')}</TabsTrigger>
          </TabsList>
        </div>

        <SidebarMenuItemsTab
          t={t}
          query={query}
          setQuery={setQuery}
          clearSearch={clearSearch}
          loading={loading}
          searchLoading={searchLoading}
          isSearchValid={isSearchValid}
          searchMessage={searchMessage}
          minLength={minLength}
          filteredItems={filteredItems}
          items={items}
          handleReorder={handleReorder}
          canManage={canManage}
          handleEdit={handleEdit}
          handleToggleVisibility={handleToggleVisibility}
        />

        <SidebarMenuGroupsTab
          t={t}
          hasChanges={hasChanges}
          activeTab={activeTab}
          handleSaveGroupOrder={handleSaveGroupOrder}
          isSaving={isSaving}
          canManage={canManage}
          groups={groups}
          handleOpenNewGroup={handleOpenNewGroup}
          handleGroupReorder={handleGroupReorder}
          handleEditGroup={handleEditGroup}
        />
      </Tabs>

      <SidebarMenuEditItemDialog
        open={!!editingItem}
        onOpenChange={(open) => {
          if (!open) setEditingItem(null);
        }}
        t={t}
        editForm={editForm}
        setEditForm={setEditForm}
        existingGroups={existingGroups}
        editingItem={editingItem}
        onSave={saveEdit}
      />

      <SidebarMenuEditGroupDialog
        open={!!editingGroup}
        onOpenChange={(open) => {
          if (!open) setEditingGroup(null);
        }}
        t={t}
        groupEditForm={groupEditForm}
        setGroupEditForm={setGroupEditForm}
        onSave={saveGroupEdit}
      />

      <SidebarMenuCreateGroupDialog
        open={showNewGroupDialog}
        onOpenChange={(open) => {
          if (!open) setShowNewGroupDialog(false);
        }}
        t={t}
        newGroupForm={newGroupForm}
        setNewGroupForm={setNewGroupForm}
        onCreate={handleCreateGroup}
      />
    </AdminPageLayout>
  );
}

export default SidebarMenuManager;
