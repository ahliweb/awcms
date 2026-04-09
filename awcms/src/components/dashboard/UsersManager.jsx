
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import UserApprovalManager from '@/components/dashboard/UserApprovalManager';
import { PageTabs, TabsContent } from '@/templates/emdash-admin';
import { usePermissions } from '@/contexts/PermissionContext';
import { useToast } from '@/components/ui/use-toast';
import { udm } from '@/lib/data/UnifiedDataManager';
import { supabase } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';
import { Calendar, ChevronRight, Crown, Layers3, Plus, RefreshCw, ShieldAlert, User, Users, Home } from 'lucide-react';
import { useSearch } from '@/hooks/useSearch';
import { useTenant } from '@/contexts/TenantContext';
import { useTranslation } from 'react-i18next';
import useSplatSegments from '@/hooks/useSplatSegments';
import { encodeRouteParam } from '@/lib/routeSecurity';
import { cn } from '@/lib/utils';
import UsersDeleteDialog from '@/components/dashboard/users/UsersDeleteDialog';
import UsersSearchToolbar from '@/components/dashboard/users/UsersSearchToolbar';
import UsersTableSection from '@/components/dashboard/users/UsersTableSection';
import DashboardModuleIntro from '@/components/dashboard/DashboardModuleIntro';

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
  const location = useLocation();
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
  const [platformRoles, setPlatformRoles] = useState([]);
  const [platformRolesLoading, setPlatformRolesLoading] = useState(false);
  const [platformRolesPage, setPlatformRolesPage] = useState(1);
  const [platformRolesPerPage, setPlatformRolesPerPage] = useState(6);
  const [platformRolesTotal, setPlatformRolesTotal] = useState(0);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState(null);

  const visibleUsersOnPage = users.length;
  const searchActive = Boolean(debouncedQuery);
  const platformRolesTotalPages = Math.max(1, Math.ceil(platformRolesTotal / platformRolesPerPage));

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
  const canViewApprovals = hasPermission('platform.approvals.read') || isPlatformAdmin;

  // Tab definitions
  const tabs = [
    { value: 'users', label: t('users.tabs.active_users'), icon: User, color: 'blue' },
    { value: 'approvals', label: t('users.tabs.approvals'), icon: ShieldAlert, color: 'amber' },
  ];

  const fetchUsers = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    const controller = new AbortController();
    const fetchTimeout = setTimeout(() => controller.abort(), 12000);
    try {
      let q = supabase.from('users')
        .select(`
          *, 
          roles:roles!users_role_id_fkey(name, is_platform_admin, is_full_access), 
          tenant:tenants(name),
          profile:user_profiles!user_profiles_user_id_fkey(job_title, department)
        `, { count: 'exact' })
        .is('deleted_at', null)
        .abortSignal(controller.signal);

      // Strict Multi-Tenancy
      if (currentTenant?.id) {
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
      if (err.name === 'AbortError') {
        toast({ variant: 'destructive', title: t('common.error'), description: 'Request timed out. Please refresh and try again.' });
      } else {
        console.error(err);
        toast({ variant: 'destructive', title: t('common.error'), description: t('common.no_data') });
      }
    } finally {
      clearTimeout(fetchTimeout);
      setLoading(false);
    }
  }, [canView, currentTenant, debouncedQuery, currentPage, itemsPerPage, toast, t]);

  const fetchPlatformRoles = useCallback(async () => {
    if (!isPlatformAdmin) return;

    setPlatformRolesLoading(true);
    try {
      let q = supabase
        .from('roles')
        .select('id, name, description, scope, tenant_id, is_platform_admin, is_full_access, created_at', { count: 'exact' })
        .is('deleted_at', null)
        .or('scope.eq.platform,is_platform_admin.eq.true,is_full_access.eq.true,tenant_id.is.null');

      if (debouncedQuery) {
        q = q.ilike('name', `%${debouncedQuery}%`);
      }

      const from = (platformRolesPage - 1) * platformRolesPerPage;
      const to = from + platformRolesPerPage - 1;

      const { data, count, error } = await q
        .range(from, to)
        .order('created_at', { ascending: false });

      if (error) throw error;

      setPlatformRoles(data || []);
      setPlatformRolesTotal(count || 0);
    } catch (error) {
      console.error('Error fetching platform roles:', error);
      toast({ variant: 'destructive', title: t('common.error'), description: t('roles.errors.load_failed', 'Failed to load platform-scope roles.') });
    } finally {
      setPlatformRolesLoading(false);
    }
  }, [isPlatformAdmin, debouncedQuery, platformRolesPage, platformRolesPerPage, toast, t]);

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

  // Re-fetch when navigating back from editor (state.refreshed set by UserEditor on save)
  useEffect(() => {
    if (location.state?.refreshed && activeTab === 'users') {
      fetchUsers();
      // Replace state to avoid re-triggering on back/forward navigation
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [location.state?.refreshed, activeTab, fetchUsers]);

  useEffect(() => {
    if (activeTab === 'users') {
      fetchUsers();
    }
  }, [activeTab, fetchUsers]);

  useEffect(() => {
    if (activeTab === 'users' && isPlatformAdmin) {
      fetchPlatformRoles();
    }
  }, [activeTab, isPlatformAdmin, fetchPlatformRoles]);

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
        let deleteQuery = udm
          .from('users')
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', userToDelete.id);

        if (currentTenant?.id) {
          deleteQuery = deleteQuery.eq('tenant_id', currentTenant.id);
        }

        await deleteQuery;
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
      label: t('users.columns.job_dept'),
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
    // Tenant column - only for Platform Admins in global context
    ...(isPlatformAdmin && !currentTenant?.id ? [{
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

  const summaryCards = useMemo(() => ([
    {
      title: t('users.tabs.active_users'),
      value: activeTab === 'users' ? totalItems : users.length,
      description: 'User accounts currently available in the active tenant or platform scope.',
      accent: 'from-primary/15 via-primary/6 to-transparent',
    },
    {
      title: t('users.tabs.approvals'),
      value: activeTab === 'approvals' ? (approvalStatus || 'pending') : 'Queue',
      description: 'Approval workflow remains refresh-safe through nested `/approvals/:status` sub-slugs.',
      accent: 'from-amber-500/15 via-amber-500/6 to-transparent',
    },
    {
      title: t('users.columns.role'),
      value: isPlatformAdmin ? t('common.global', 'Global') : t('users.breadcrumbs.users'),
      description: currentTenant?.name || 'Current ABAC access scope',
      accent: 'from-sky-500/15 via-sky-500/6 to-transparent',
    },
  ]), [activeTab, totalItems, users.length, approvalStatus, t, isPlatformAdmin, currentTenant?.name]);

  return (
    <div className="space-y-6">
      {!canView && activeTab === 'users' ? (
        <div className="rounded-2xl border border-destructive/25 bg-destructive/8 px-4 py-3 text-sm text-destructive shadow-sm">
          <span className="font-semibold">{t('common.access_denied', 'Access denied')}.</span> {t('users.errors.no_view_permission', 'You do not have permission to view users.')}
        </div>
      ) : null}

      <UsersDeleteDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        userToDelete={userToDelete}
        onConfirm={handleConfirmDelete}
        t={t}
      />

      <nav className="mb-6">
        <ol className="flex flex-wrap items-center gap-1.5 break-words text-sm text-muted-foreground sm:gap-2.5">
          <li className="inline-flex items-center gap-1.5">
            <Link to="/cmspanel" className="flex items-center gap-1 transition-colors hover:text-foreground">
              <Home className="h-4 w-4" />
              Dashboard
            </Link>
          </li>
          <li aria-hidden="true" className="[&>svg]:size-3.5"><ChevronRight /></li>
          <li className="inline-flex items-center gap-1.5">
            <div
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 font-medium transition-colors ${activeTab === 'approvals'
                ? 'cursor-pointer border border-slate-900/10 bg-white/75 text-muted-foreground hover:bg-white dark:border-white/10 dark:bg-slate-900/55'
                : 'bg-slate-950 text-white shadow-sm dark:bg-white dark:text-slate-950'
                }`}
              onClick={activeTab === 'approvals' ? () => navigate('/cmspanel/users', { replace: true }) : undefined}
            >
              <span>{t('users.breadcrumbs.users')}</span>
            </div>
          </li>
          {activeTab === 'approvals' && (
            <>
              <li aria-hidden="true" className="[&>svg]:size-3.5"><ChevronRight /></li>
              <li className="inline-flex items-center gap-1.5">
                <div className="flex items-center gap-1.5 rounded-full bg-slate-950 px-3 py-1 font-medium text-white shadow-sm dark:bg-white dark:text-slate-950">
                  <span>{t('users.breadcrumbs.approvals')}</span>
                </div>
              </li>
            </>
          )}
        </ol>
      </nav>

      <DashboardModuleIntro
        icon={Users}
        eyebrow="Users"
        title={activeTab === 'approvals' ? t('users.tabs.approvals') : t('users.title')}
        description={activeTab === 'approvals' ? 'Review registration approvals through refresh-safe nested sub-slugs while keeping onboarding decisions visible and auditable.' : 'Manage tenant and platform users with ABAC-aware access, secure edit routes, and cleaner cross-module coordination with roles and permissions.'}
        actions={activeTab === 'users' ? headerActions : null}
        badges={[
          { icon: Layers3, iconClassName: 'text-primary', label: 'Refresh-safe `/cmspanel/users` route shell' },
          { icon: User, iconClassName: 'text-primary', label: isPlatformAdmin ? 'Platform ABAC scope active' : `Tenant ABAC scope: ${currentTenant?.name || 'Current tenant'}` },
          { icon: Calendar, iconClassName: 'text-primary', label: activeTab === 'approvals' ? (approvalStatus || 'pending') : `${visibleUsersOnPage} visible users` },
        ]}
        summaryCards={summaryCards}
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
          {canView ? (
            <>
              {isPlatformAdmin ? (
                <div className="emdash-panel space-y-4 p-5">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-foreground">{t('roles.platform_cards_title', 'Platform-Scope Role Card Management')}</h3>
                      <p className="text-sm text-muted-foreground">{t('roles.platform_cards_desc', 'Platform-owned user access and privileged assignments stay visible here above the tenant-dependent user management section so global role governance remains independent of active tenant filtering.')}</p>
                    </div>
                    <div className="inline-flex items-center rounded-full border border-slate-900/10 bg-white/78 px-3 py-1.5 text-xs font-medium text-muted-foreground dark:border-white/10 dark:bg-slate-950/45">
                      {platformRolesTotal} {t('roles.platform_scope_count', 'platform-scope roles')}
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {platformRolesLoading ? Array.from({ length: platformRolesPerPage }).map((_, index) => (
                      <div key={index} className="h-44 animate-pulse rounded-[1.5rem] border border-border/60 bg-muted/40" />
                    )) : platformRoles.map((role) => (
                      <div key={role.id} className="rounded-[1.5rem] border border-slate-900/10 bg-white/84 p-4 shadow-[0_18px_36px_-28px_rgba(15,23,42,0.45)] dark:border-white/10 dark:bg-slate-950/45">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-foreground">{role.name || '-'}</p>
                            <p className="truncate text-xs text-muted-foreground">{role.description || t('common.not_set', 'Not set')}</p>
                          </div>
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-500">
                            <Crown className="h-3 w-3 fill-amber-500 text-amber-500" />
                            {t('roles.badges.tenant_root', 'Platform ABAC')}
                          </span>
                        </div>

                        <div className="mt-4 space-y-2 text-xs text-muted-foreground">
                          <div className="flex items-center justify-between gap-3">
                            <span>{t('users.columns.role')}</span>
                            <span className="font-medium text-foreground">{role.scope || 'platform'}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span>{t('users.columns.tenant')}</span>
                            <span className="font-medium text-foreground">{role.tenant_id ? t('roles.tenant_bound', 'Tenant-bound') : t('common.global')}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span>{t('roles.columns.permissions', 'Access')}</span>
                            <span className="font-medium text-foreground">{role.is_full_access || role.is_platform_admin ? t('roles.badges.all_access', 'Elevated') : t('roles.managed_access', 'Managed')}</span>
                          </div>
                        </div>

                        <div className="mt-4 flex items-center justify-between gap-2">
                          <span className="text-[11px] text-muted-foreground">{t('common.created', 'Created')} {role.created_at ? new Date(role.created_at).toLocaleDateString() : '-'}</span>
                          {canEdit ? (
                            <Button size="sm" variant="outline" className="rounded-2xl" onClick={() => navigate('/cmspanel/roles')}>
                              {t('common.edit', 'Edit')}
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-col gap-3 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-sm text-muted-foreground">
                      {t('common.showing', 'Showing')} {platformRoles.length === 0 ? 0 : ((platformRolesPage - 1) * platformRolesPerPage) + 1} {t('common.to', 'to')} {Math.min(platformRolesPage * platformRolesPerPage, platformRolesTotal)} {t('common.of', 'of')} {platformRolesTotal} {t('roles.platform_scope_count', 'platform-scope roles')}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={platformRolesPerPage}
                        onChange={(e) => {
                          setPlatformRolesPerPage(Number(e.target.value));
                          setPlatformRolesPage(1);
                        }}
                        className="h-10 rounded-xl border border-border/70 bg-background px-3 text-sm text-foreground shadow-sm"
                      >
                        {[3, 6, 9, 12].map((value) => (
                          <option key={value} value={value}>{value} / {t('common.page', 'page')}</option>
                        ))}
                      </select>
                      <Button variant="outline" className="rounded-xl" disabled={platformRolesPage <= 1} onClick={() => setPlatformRolesPage((page) => Math.max(1, page - 1))}>
                        {t('common.previous', 'Previous')}
                      </Button>
                      <span className="px-2 text-sm text-muted-foreground">{t('common.page', 'Page')} {platformRolesPage} {t('common.of', 'of')} {platformRolesTotalPages}</span>
                      <Button variant="outline" className="rounded-xl" disabled={platformRolesPage >= platformRolesTotalPages} onClick={() => setPlatformRolesPage((page) => Math.min(platformRolesTotalPages, page + 1))}>
                        {t('common.next', 'Next')}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}

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

              <div className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t('users.tenant_management_title', 'Tenant-Dependent User Management')}</p>
                  <p className="text-xs text-muted-foreground">{currentTenant?.name || t('common.global')}</p>
                </div>
              </div>

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
            </>
          ) : null}
        </TabsContent>

        <TabsContent value="approvals" className="mt-0">
          {canViewApprovals ? (
            <UserApprovalManager
              activeTab={approvalsSegments[0]}
              onTabChange={(value) => {
                navigate(`/cmspanel/users/approvals/${value}`);
              }}
              embedded
            />
          ) : (
            <div className="rounded-2xl border border-destructive/25 bg-destructive/8 px-4 py-3 text-sm text-destructive shadow-sm">
              <span className="font-semibold">{t('common.access_denied', 'Access denied')}.</span> {t('users.errors.no_approvals_permission', 'You do not have permission to review user approvals.')}
            </div>
          )}
        </TabsContent>
      </PageTabs>
    </div>
  );
}

export default UsersManager;
