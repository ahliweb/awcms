
import React, { useState, useEffect, useCallback } from 'react';
import ContentTable from '@/components/dashboard/ContentTable';
import UserEditor from '@/components/dashboard/UserEditor';
import UserApprovalManager from '@/components/dashboard/UserApprovalManager';
import { AdminPageLayout, PageHeader, PageTabs, TabsContent } from '@/templates/flowbite-admin';
import { usePermissions } from '@/contexts/PermissionContext';
import { sanitizeHTML } from '@/utils/sanitize';
import { useToast } from '@/components/ui/use-toast';
import { udm } from '@/lib/data/UnifiedDataManager';
import { supabase } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';
import { Plus, RefreshCw, User, ShieldAlert, Trash2, Crown } from 'lucide-react';
import { useSearch } from '@/hooks/useSearch';
import MinCharSearchInput from '@/components/common/MinCharSearchInput';
import { useTenant } from '@/contexts/TenantContext';
import { useTranslation } from 'react-i18next';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/**
 * UsersManager - Manages users and registration approvals.
 * Refactored to use awadmintemplate01 components for consistent UI and i18n.
 */
function UsersManager() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { hasPermission, isPlatformAdmin } = usePermissions();
  const { currentTenant } = useTenant();

  // State declarations
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  // Search
  const {
    query,
    setQuery,
    debouncedQuery,
    isValid: isSearchValid,
    message: searchMessage,
    loading: searchLoading,
    minLength,
    clearSearch
  } = useSearch({ context: 'admin' });

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [totalItems, setTotalItems] = useState(0);
  const [showEditor, setShowEditor] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState(null);
  const [activeTab, setActiveTab] = useState('users');

  // Permission checks
  const canView = hasPermission('tenant.user.read');
  const canCreate = hasPermission('tenant.user.create');
  const canEdit = hasPermission('tenant.user.update');
  const canDelete = hasPermission('tenant.user.delete');

  // Tab definitions
  const tabs = [
    { value: 'users', label: t('users.tabs.active_users'), icon: User, color: 'blue' },
    { value: 'approvals', label: t('users.tabs.approvals'), icon: ShieldAlert, color: 'amber' },
  ];

  // Breadcrumbs
  const breadcrumbs = [
    { label: t('users.breadcrumbs.users'), href: activeTab !== 'users' ? '/cmspanel/users' : undefined, icon: User },
    ...(activeTab === 'approvals' ? [{ label: t('users.breadcrumbs.approvals') }] : []),
  ];

  const fetchUsers = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    try {
      let q = udm.from('users')
        .select('*, roles!users_role_id_fkey(name, is_platform_admin, is_full_access), tenant:tenants(name)', { count: 'exact' })
        .is('deleted_at', null);

      // Strict Multi-Tenancy
      if (!isPlatformAdmin && currentTenant?.id) {
        q = q.eq('tenant_id', currentTenant.id);
      }

      if (debouncedQuery) {
        q = q.ilike('email', `%${debouncedQuery}%`);
      }

      const from = (currentPage - 1) * itemsPerPage;
      const to = from + itemsPerPage - 1;

      const { data, count, error } = await q
        .range(from, to)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setUsers(data || []);
      setTotalItems(count || 0);
    } catch (err) {
      console.error(err);
      toast({ variant: 'destructive', title: t('common.error'), description: t('common.no_data') }); // Fallback error msg
    } finally {
      setLoading(false);
    }
  }, [canView, isPlatformAdmin, currentTenant, debouncedQuery, currentPage, itemsPerPage, toast, t]);

  // Actions for header
  const headerActions = (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="icon"
        onClick={fetchUsers}
        title={t('common.refresh')}
        className="h-10 w-10 border-slate-200/70 bg-white/70 hover:bg-white shadow-sm"
      >
        <RefreshCw className="h-4 w-4" />
      </Button>
      {canCreate ? (
        <Button
          onClick={() => { setSelectedUser(null); setShowEditor(true); }}
          className="bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm"
        >
          <Plus className="mr-2 h-4 w-4" />
          {t('users.create_user')}
        </Button>
      ) : null}
    </div>
  );

  useEffect(() => {
    if (activeTab === 'users') {
      fetchUsers();
    }
  }, [activeTab, fetchUsers]);

  const handleEdit = (user) => {
    setSelectedUser(user);
    setShowEditor(true);
  };

  const handleSave = () => {
    setShowEditor(false);
    setSelectedUser(null);
    fetchUsers();
  };

  const openDeleteDialog = (user) => {
    setUserToDelete(user);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!userToDelete) return;

    setLoading(true);
    setDeleteDialogOpen(false);

    try {
      if (navigator.onLine) {
        const { data, error } = await supabase.functions.invoke('manage-users', {
          body: { action: 'delete', user_id: userToDelete.id }
        });

        if (error) throw error;
        if (data && data.error) throw new Error(data.error);
      } else {
        await udm.from('users').update({ deleted_at: new Date().toISOString() }).eq('id', userToDelete.id);
        toast({ title: 'Offline', description: 'User marked for deletion. Will sync when online.' });
      }

      toast({ title: t('common.success'), description: t('common.move_to_trash_confirm', { resource: t('users.breadcrumbs.users') }) });
      fetchUsers();
    } catch (err) {
      console.error('Delete error:', err);
      toast({
        variant: 'destructive',
        title: t('common.error'),
        description: err.message || 'Could not delete user'
      });
    } finally {
      setLoading(false);
      setUserToDelete(null);
    }
  };

  const columns = [
    { key: 'email', label: t('users.columns.email') },
    { key: 'full_name', label: t('users.columns.full_name') },
    {
      key: 'roles',
      label: t('users.columns.role'),
      render: (r) => {
        if (!r?.name) return <span className="text-muted-foreground text-xs">{t('users.guest')}</span>;
        if (r.is_platform_admin || r.is_full_access) {
          return (
            <span className="flex items-center gap-1 bg-amber-500/10 px-2 py-1 rounded-full text-xs font-bold text-amber-600 dark:text-amber-500 border border-amber-500/20">
              <Crown className="w-3 h-3 fill-amber-500 text-amber-500" />
              {t('roles.badges.tenant_root')}
            </span>
          );
        }
        return (
          <span className="capitalize bg-secondary px-2 py-1 rounded-full text-xs font-medium text-secondary-foreground">
            {r.name.replace('_', ' ')}
          </span>
        );
      }
    },
    // Tenant column - only for Platform Admins
    ...(isPlatformAdmin ? [{
      key: 'tenant',
      label: t('users.columns.tenant'),
      render: (_, item) => item.tenant?.name ? (
        <span className="bg-primary/10 text-primary px-2 py-1 rounded-full text-xs font-medium border border-primary/20">
          {item.tenant.name}
        </span>
      ) : <span className="text-muted-foreground bg-muted px-2 py-1 rounded-full text-xs font-medium border border-border">{t('common.global')}</span>
    }] : []),
    { key: 'created_at', label: t('users.joined'), type: 'date' }
  ];

  if (showEditor) {
    return (
      <UserEditor
        user={selectedUser}
        onClose={() => { setShowEditor(false); setSelectedUser(null); }}
        onSave={handleSave}
      />
    );
  }

  return (
    <AdminPageLayout requiredPermission="tenant.user.read">
      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-red-500" />
              {t('users.delete.title')}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p dangerouslySetInnerHTML={{ __html: sanitizeHTML(t('users.delete.confirm', { name: userToDelete?.full_name || userToDelete?.email })) }} />
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-800 text-sm">
                  <p className="font-medium mb-1">⚠️ {t('users.delete.warning_role')}</p>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
                  <p className="font-medium">🚫 {t('common.error')}:</p>
                  <p>{t('users.delete.warning_restore')}</p>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-red-600 hover:bg-red-700">
              {t('common.move_to_trash')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Page Header */}
      <PageHeader
        title={t('users.title')}
        description={t('users.subtitle')}
        icon={User}
        breadcrumbs={breadcrumbs}
        actions={activeTab === 'users' ? headerActions : []}
      />

      {/* Tabs Navigation */}
      <PageTabs value={activeTab} onValueChange={setActiveTab} tabs={tabs}>
        <TabsContent value="users" className="space-y-6 mt-0">
          {/* Search Bar */}
          <div className="bg-card p-4 rounded-xl border border-border shadow-sm flex flex-col gap-3 md:flex-row md:items-center">
            <div className="flex-1 max-w-sm">
              <MinCharSearchInput
                value={query}
                onChange={e => setQuery(e.target.value)}
                onClear={clearSearch}
                loading={loading || searchLoading}
                isValid={isSearchValid}
                message={searchMessage}
                minLength={minLength}
                placeholder={t('common.search_resource', { resource: t('users.breadcrumbs.users') })}
              />
            </div>
            <div className="flex-1"></div>
            <Button
              variant="ghost"
              size="icon"
              onClick={fetchUsers}
              title={t('common.refresh')}
              disabled={loading}
              className="text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>

          {/* Users Table */}
          <ContentTable
            data={users}
            columns={columns}
            loading={loading}
            onEdit={canEdit ? handleEdit : null}
            onDelete={canDelete ? openDeleteDialog : null}
            pagination={{
              currentPage,
              totalPages: Math.ceil(totalItems / itemsPerPage),
              totalItems,
              itemsPerPage,
              onPageChange: setCurrentPage,
              onLimitChange: setItemsPerPage
            }}
          />
        </TabsContent>

        <TabsContent value="approvals" className="mt-0">
          <UserApprovalManager />
        </TabsContent>
      </PageTabs>
    </AdminPageLayout>
  );
}

export default UsersManager;
