import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Crown, Layers3, Shield, ShieldCheck } from 'lucide-react';
import GenericContentManager from '@/components/dashboard/GenericContentManager';
import { Button } from '@/components/ui/button';
import { encodeRouteParam } from '@/lib/routeSecurity';
import { useToast } from '@/components/ui/use-toast';
import { usePermissions } from '@/contexts/PermissionContext';
import { useTenant } from '@/contexts/TenantContext';
import { supabase } from '@/lib/customSupabaseClient';
import DashboardModuleIntro from '@/components/dashboard/DashboardModuleIntro';
import { cn } from '@/lib/utils';

function RolesManager() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { hasPermission, isPlatformAdmin } = usePermissions();
  const { currentTenant } = useTenant();
  const [summary, setSummary] = useState({
    totalRoles: 0,
    privilegedRoles: 0,
    permissionLinks: 0,
  });
  const [platformRoles, setPlatformRoles] = useState([]);
  const [platformRolesLoading, setPlatformRolesLoading] = useState(false);
  const [platformRolesPage, setPlatformRolesPage] = useState(1);
  const [platformRolesPerPage, setPlatformRolesPerPage] = useState(6);
  const [platformRolesTotal, setPlatformRolesTotal] = useState(0);

  const platformRolesTotalPages = Math.max(1, Math.ceil(platformRolesTotal / platformRolesPerPage));

  useEffect(() => {
    let active = true;

    const loadSummary = async () => {
      try {
        const [{ data: roles, error: rolesError }, { data: rolePerms, error: permsError }] = await Promise.all([
          supabase
            .from('roles')
            .select('id, scope, is_platform_admin, is_full_access')
            .is('deleted_at', null),
          supabase
            .from('role_permissions')
            .select('role_id')
            .is('deleted_at', null),
        ]);

        if (rolesError) throw rolesError;
        if (permsError) throw permsError;

        if (!active) return;

        const roleRows = roles || [];
        const rolePermissionRows = rolePerms || [];

        setSummary({
          totalRoles: roleRows.length,
          privilegedRoles: roleRows.filter((role) => role.is_platform_admin || role.is_full_access || role.scope === 'platform').length,
          permissionLinks: rolePermissionRows.length,
        });
      } catch (error) {
        console.error('Error loading role summary:', error);
      }
    };

    loadSummary();

    return () => {
      active = false;
    };
  }, []);

  const handleOpenRole = async (role) => {
    const routeId = await encodeRouteParam({ value: role.id, scope: 'roles.edit' });
    if (!routeId) {
      toast({ variant: 'destructive', title: t('common.error'), description: t('roles.errors.load_failed', 'Unable to open role editor.') });
      return;
    }
    navigate(`/cmspanel/roles/edit/${routeId}`);
  };

  useEffect(() => {
    if (!isPlatformAdmin) return;

    let active = true;

    const loadPlatformRoles = async () => {
      try {
        setPlatformRolesLoading(true);
        const from = (platformRolesPage - 1) * platformRolesPerPage;
        const to = from + platformRolesPerPage - 1;

        const { data, count, error } = await supabase
          .from('roles')
          .select('id, name, description, scope, tenant_id, is_platform_admin, is_full_access, created_at', { count: 'exact' })
          .is('deleted_at', null)
          .or('scope.eq.platform,is_platform_admin.eq.true,is_full_access.eq.true,tenant_id.is.null')
          .order('name')
          .range(from, to);

        if (error) throw error;
        if (!active) return;

        setPlatformRoles(data || []);
        setPlatformRolesTotal(count || 0);
      } catch (error) {
        console.error('Error loading platform roles:', error);
      } finally {
        if (active) {
          setPlatformRolesLoading(false);
        }
      }
    };

    loadPlatformRoles();

    return () => {
      active = false;
    };
  }, [isPlatformAdmin, platformRolesPage, platformRolesPerPage]);

  const summaryCards = useMemo(() => ([
    {
      title: t('roles.summary.roles', 'Roles'),
      value: summary.totalRoles,
      description: t('roles.summary.roles_desc', 'Tenant and platform role definitions available in the current access scope.'),
      accent: 'from-primary/15 via-primary/6 to-transparent',
    },
    {
      title: t('roles.summary.privileged_roles', 'Privileged Roles'),
      value: summary.privilegedRoles,
      description: t('roles.summary.privileged_roles_desc', 'Roles carrying platform or full-access flags that require extra review before editing.'),
      accent: 'from-amber-500/15 via-amber-500/6 to-transparent',
    },
    {
      title: t('roles.summary.permission_links', 'Permission Links'),
      value: summary.permissionLinks,
      description: t('roles.summary.permission_links_desc', 'Active role-to-permission assignments currently enforced by the permission matrix.'),
      accent: 'from-sky-500/15 via-sky-500/6 to-transparent',
    },
  ]), [summary, t]);

  const headerContent = (
    <div className="space-y-8">
      <DashboardModuleIntro
        icon={Shield}
        eyebrow={t('roles.eyebrow', 'Access Control')}
        title={t('roles.governance_title', 'Role Governance')}
        description={t('roles.governance_desc', 'Manage tenant and platform roles, route users into secure role editors, and keep the permission matrix aligned with current access policy rules.')}
        badges={[
          { icon: Layers3, iconClassName: 'text-primary', label: t('roles.badges.route_shell', 'Refresh-safe `/cmspanel/roles` route shell') },
          { icon: ShieldCheck, iconClassName: 'text-emerald-600', label: t('roles.badges.matrix_alignment', 'Signed edit routes and permission-gated matrix') },
          { icon: Shield, iconClassName: 'text-primary', label: isPlatformAdmin ? 'Platform ABAC scope active' : `Tenant ABAC scope: ${currentTenant?.name || 'Current tenant'}` },
        ]}
        summaryCards={summaryCards}
      />

      {isPlatformAdmin ? (
        <div className="emdash-panel space-y-4 p-5">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-foreground">{t('roles.platform_cards_heading', 'Platform-Scope Role Cards')}</h3>
              <p className="text-sm text-muted-foreground">{t('roles.platform_cards_hint', 'Global and privileged roles stay available here even when tenant-dependent role management is scoped to the current tenant.')}</p>
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
                    <p className="truncate text-sm font-semibold text-foreground">{role.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{role.description || t('common.not_set', 'Not set')}</p>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-500">
                    <Crown className="h-3 w-3 fill-amber-500 text-amber-500" />
                    {t('roles.badges.platform_abac', 'Platform ABAC')}
                  </span>
                </div>

                <div className="mt-4 space-y-2 text-xs text-muted-foreground">
                  <div className="flex items-center justify-between gap-3">
                    <span>{t('roles.columns.scope', 'Scope')}</span>
                    <span className="font-medium text-foreground">{role.scope || 'platform'}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>{t('users.columns.tenant', 'Tenant')}</span>
                    <span className="font-medium text-foreground">{role.tenant_id ? 'Tenant-bound' : 'Global'}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>{t('roles.columns.access', 'Access')}</span>
                    <span className="font-medium text-foreground">{role.is_full_access || role.is_platform_admin ? 'Elevated' : 'Managed'}</span>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-muted-foreground">{t('common.created', 'Created')} {role.created_at ? new Date(role.created_at).toLocaleDateString() : '-'}</span>
                  <Button size="sm" variant="outline" className="rounded-2xl" onClick={() => handleOpenRole(role)}>
                    {t('common.edit', 'Edit')}
                  </Button>
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

      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t('roles.tenant_management_title', 'Tenant-Dependent Role Management')}</p>
          <p className="text-xs text-muted-foreground">{currentTenant?.name || (isPlatformAdmin ? t('common.global') : t('roles.current_tenant', 'Current tenant'))}</p>
        </div>
      </div>
    </div>
  );

  const columns = [
    {
      key: 'name',
      label: t('roles.columns.name'),
      className: 'min-w-[220px]',
      render: (name, row) => (
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <Shield className={cn('h-4 w-4', row.is_full_access || row.is_platform_admin ? 'text-primary' : 'text-muted-foreground')} />
            <span className="text-sm font-semibold text-foreground">{name}</span>
            {(row.is_platform_admin || row.is_full_access) && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-500">
                <Crown className="h-3 w-3 fill-amber-500 text-amber-500" />
                {t('roles.badges.tenant_root')}
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">ID: {row.id?.slice(0, 8) || '-'}</p>
        </div>
      )
    },
    {
      key: 'description',
      label: t('roles.columns.description'),
      className: 'min-w-[220px]',
      render: (value) => (
        <span className="text-sm text-muted-foreground">{value || t('common.not_set', 'Not set')}</span>
      )
    },
    {
      key: 'permissions_count',
      label: t('roles.columns.permissions'),
      className: 'min-w-[160px]',
      render: (_, row) => {
        const count = Array.isArray(row.role_permissions)
          ? row.role_permissions.filter((permission) => !permission.deleted_at).length
          : 0;
        if (row.is_full_access || row.is_platform_admin) {
          return <span className="inline-flex items-center rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">{t('roles.badges.all_access')} ({count || '∞'})</span>;
        }
        return <span className="inline-flex items-center rounded-full border border-border/70 bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">{count || 0} {t('roles.columns.permissions')}</span>;
      }
    },
    {
      key: 'tenant',
      label: t('users.columns.tenant', 'Tenant Name'),
      className: 'min-w-[180px]',
      render: (_, row) => (
        <span className="text-sm text-muted-foreground">{row.tenant?.name || (row.tenant_id ? t('common.not_set', 'Not set') : t('common.global'))}</span>
      )
    }
  ];

  if (!hasPermission('tenant.role.read')) {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center rounded-2xl border border-border/60 bg-card/70 p-8 text-center text-muted-foreground shadow-sm">
        {t('roles.errors.no_view_permission', 'You do not have permission to view roles.')}
      </div>
    );
  }

  return (
    <GenericContentManager
      tableName="roles"
      resourceName={t('roles.title')}
      columns={columns}
      permissionPrefix="role"
      customSelect="*, tenant:tenants(name), owner:users!roles_created_by_fkey(email), role_permissions(permission_id, deleted_at)"
      headerContent={headerContent}
      onCreateOverride={() => navigate('/cmspanel/roles/new')}
      onEditOverride={handleOpenRole}
    />
  );
}

export default RolesManager;
