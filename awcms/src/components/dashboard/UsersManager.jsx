
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import UserApprovalManager from '@/components/dashboard/UserApprovalManager';
import { AdminPageLayout, PageHeader, PageTabs, TabsContent } from '@/templates/flowbite-admin';
import { usePermissions } from '@/contexts/PermissionContext';
import { useToast } from '@/components/ui/use-toast';
import { udm } from '@/lib/data/UnifiedDataManager';
import { supabase } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';
import { Plus, RefreshCw, User, ShieldAlert, Crown } from 'lucide-react';
import { useSearch } from '@/hooks/useSearch';
import { useTenant } from '@/contexts/TenantContext';
import { useTranslation } from 'react-i18next';
import useSplatSegments from '@/hooks/useSplatSegments';
import { encodeRouteParam } from '@/lib/routeSecurity';
import { cn } from '@/lib/utils';
import UsersDeleteDialog from '@/components/dashboard/users/UsersDeleteDialog';
import UsersSearchToolbar from '@/components/dashboard/users/UsersSearchToolbar';
import UsersTableSection from '@/components/dashboard/users/UsersTableSection';

/**
 * UsersManager - Manages users and registration approvals.
 * Refactored to use awadmintemplate01 components for consistent UI and i18n.
 */
function UsersManager() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { hasPermission, isPlatformAdmin } = usePermissions();
  const { currentTenant } = useTenant();
  const navigate = useNavigate();
  const segments = useSplatSegments();
  const tabValues = ['users', 'approvals'];
  const hasTabSegment = tabValues.includes(segments[0]);
  const activeTab = hasTabSegment ? segments[0] : 'users';
  const approvalsSegments = hasTabSegment && segments[0] === 'approvals' ? segments.slice(1) : [];
  const approvalStatuses = ['pending', 'completed', 'rejected'];
  const approvalStatus = approvalsSegments[0];
  const hasValidApprovalStatus = approvalStatuses.includes(approvalStatus);
  const hasExtraSegments = approvalsSegments.length > 1;

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
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState(null);

  const visibleUsersOnPage = users.length;
  const searchActive = Boolean(debouncedQuery);

  useEffect(() => {
    if (segments.length > 0 && !hasTabSegment) {
      navigate('/cmspanel/users', { replace: true });
      return;
    }

    if (segments[0] === 'users' && segments.length > 1) {
      navigate('/cmspanel/users', { replace: true });
      return;
    }

    if (segments[0] === 'approvals' && (!hasValidApprovalStatus || hasExtraSegments)) {
      navigate('/cmspanel/users/approvals/pending', { replace: true });
    }
  }, [segments, hasTabSegment, hasValidApprovalStatus, hasExtraSegments, navigate]);

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
        .select(`
          *, 
          roles:roles!users_role_id_fkey(name, is_platform_admin, is_full_access), 
          tenant:tenants(name),
          profile:user_profiles!user_profiles_user_id_fkey(job_title, department)
        `, { count: 'exact' })
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
        onClick={fetchUsers}
        title={t('common.refresh')}
        className="h-10 rounded-xl border-border/70 bg-background/80 px-3 text-muted-foreground shadow-sm hover:bg-accent/70 hover:text-foreground"
      >
        <RefreshCw className={cn('mr-1.5 h-4 w-4', loading && 'animate-spin')} />
        <span className="hidden sm:inline">{t('common.refresh')}</span>
      </Button>

      {canCreate ? (
        <Button
          onClick={() => navigate('/cmspanel/users/new')}
          className="h-10 rounded-xl bg-primary px-4 text-primary-foreground shadow-sm hover:opacity-95"
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

  const handleEdit = async (user) => {
    const routeId = await encodeRouteParam({ value: user.id, scope: 'users.edit' });
    if (!routeId) {
      toast({ variant: 'destructive', title: t('common.error'), description: t('users.errors.load_failed', 'Unable to open user editor.') });
      return;
    }
    navigate(`/cmspanel/users/edit/${routeId}`);
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
    {
      key: 'email',
      label: t('users.columns.email'),
      className: 'min-w-[220px]',
      render: (email, item) => (
        <div className="space-y-0.5">
          <p className="truncate text-sm font-semibold text-foreground">{email || '-'}</p>
          <p className="text-[11px] text-muted-foreground">ID: {item.id?.slice(0, 8) || '-'}</p>
        </div>
      )
    },
    {
      key: 'full_name',
      label: t('users.columns.full_name'),
      className: 'min-w-[180px]',
      render: (value, item) => (
        <div className="space-y-0.5">
          <p className="truncate text-sm font-medium text-foreground">{value || t('users.guest')}</p>
          <p className="truncate text-[11px] text-muted-foreground">{item.phone || item.username || t('common.not_set', 'Not set')}</p>
        </div>
      )
    },
    {
      key: 'profile',
      label: 'Job / Dept',
      className: 'min-w-[140px]',
      render: (_, item) => (
        <div className="space-y-0.5">
          <span className="text-xs font-medium text-foreground">{item.profile?.job_title || '-'}</span>
          <span className="text-[11px] text-muted-foreground">{item.profile?.department || t('common.not_set', 'Not set')}</span>
        </div>
      )
    },
    {
      key: 'roles',
      label: t('users.columns.role'),
      className: 'min-w-[130px]',
      render: (r) => {
        if (!r?.name) return <span className="text-muted-foreground text-xs">{t('users.guest')}</span>;
        if (r.is_platform_admin || r.is_full_access) {
          return (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-xs font-bold text-amber-600 dark:text-amber-500">
              <Crown className="w-3 h-3 fill-amber-500 text-amber-500" />
              {t('roles.badges.tenant_root')}
            </span>
          );
        }
        return (
          <span className="inline-flex items-center rounded-full border border-border/70 bg-secondary px-2.5 py-1 text-xs font-medium capitalize text-secondary-foreground">
            {r.name.replace('_', ' ')}
          </span>
        );
      }
    },
    // Tenant column - only for Platform Admins
    ...(isPlatformAdmin ? [{
      key: 'tenant',
      label: t('users.columns.tenant'),
      className: 'min-w-[140px]',
      render: (_, item) => item.tenant?.name ? (
        <span className="inline-flex items-center rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
          {item.tenant.name}
        </span>
      ) : <span className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">{t('common.global')}</span>
    }] : []),
    { key: 'created_at', label: t('users.joined'), type: 'date', className: 'min-w-[110px]' }
  ];

  return (
    <AdminPageLayout requiredPermission="tenant.user.read">
      <UsersDeleteDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        userToDelete={userToDelete}
        onConfirm={handleConfirmDelete}
        t={t}
      />

      {/* Page Header */}
      <PageHeader
        title={t('users.title')}
        description={t('users.subtitle')}
        icon={User}
        breadcrumbs={breadcrumbs}
        actions={activeTab === 'users' ? headerActions : null}
      />

      {/* Tabs Navigation */}
      <PageTabs
        value={activeTab}
        onValueChange={(value) => {
          if (value === 'users') {
            navigate('/cmspanel/users');
          } else {
            navigate('/cmspanel/users/approvals/pending');
          }
        }}
        tabs={tabs}
      >
        <TabsContent value="users" className="space-y-6 mt-0">
          <UsersSearchToolbar
            t={t}
            query={query}
            setQuery={setQuery}
            clearSearch={clearSearch}
            loading={loading}
            searchLoading={searchLoading}
            isSearchValid={isSearchValid}
            searchMessage={searchMessage}
            minLength={minLength}
            placeholder={t('common.search_resource', { resource: t('users.breadcrumbs.users') })}
            totalItems={totalItems}
            visibleUsersOnPage={visibleUsersOnPage}
            searchActive={searchActive}
            onRefresh={fetchUsers}
          />

          <UsersTableSection
            t={t}
            currentPage={currentPage}
            users={users}
            columns={columns}
            loading={loading}
            canEdit={canEdit}
            canDelete={canDelete}
            onEdit={handleEdit}
            onDelete={openDeleteDialog}
            totalItems={totalItems}
            itemsPerPage={itemsPerPage}
            onPageChange={setCurrentPage}
            onLimitChange={setItemsPerPage}
          />
        </TabsContent>

        <TabsContent value="approvals" className="mt-0">
          <UserApprovalManager
            activeTab={approvalsSegments[0]}
            onTabChange={(value) => {
              navigate(`/cmspanel/users/approvals/${value}`);
            }}
          />
        </TabsContent>
      </PageTabs>
    </AdminPageLayout>
  );
}

export default UsersManager;
