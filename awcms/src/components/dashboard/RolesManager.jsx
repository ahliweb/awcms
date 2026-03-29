import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Crown, Layers3, Shield, ShieldCheck } from 'lucide-react';
import GenericContentManager from '@/components/dashboard/GenericContentManager';
import { Button } from '@/components/ui/button';
import { encodeRouteParam } from '@/lib/routeSecurity';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/contexts/PermissionContext';
import { useTenant } from '@/contexts/TenantContext';
import { supabase } from '@/lib/customSupabaseClient';
import { Card, CardContent } from '@/components/ui/card';

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
      title: 'Roles',
      value: summary.totalRoles,
      description: 'Tenant and platform role definitions available in the current access scope.',
      accent: 'from-primary/15 via-primary/6 to-transparent',
    },
    {
      title: 'Privileged Roles',
      value: summary.privilegedRoles,
      description: 'Roles carrying platform or full-access flags that require extra review before editing.',
      accent: 'from-amber-500/15 via-amber-500/6 to-transparent',
    },
    {
      title: 'Permission Links',
      value: summary.permissionLinks,
      description: 'Active role-to-permission assignments currently enforced by the permission matrix.',
      accent: 'from-sky-500/15 via-sky-500/6 to-transparent',
    },
  ]), [summary]);

  const headerContent = (
    <div className="space-y-8">
      <div className="rounded-3xl border border-border/70 bg-gradient-to-br from-background via-background to-primary/5 p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1.5">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-sm">
                <Shield className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Access Control</p>
                <p className="text-lg font-semibold text-foreground">Role Governance</p>
              </div>
            </div>
            <p className="max-w-3xl text-sm text-muted-foreground">Manage tenant and platform roles, route users into secure role editors, and keep the permission matrix aligned with current access policy rules.</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <span className="rounded-full border border-border/70 bg-background/80 px-3 py-1 text-xs font-medium text-foreground shadow-sm">
              {isPlatformAdmin ? 'Platform scope active' : `Tenant scope: ${currentTenant?.name || 'Current tenant'}`}
            </span>
            <span className="rounded-full border border-border/70 bg-background/80 px-3 py-1 text-xs font-medium text-foreground shadow-sm">
              Signed role editor routes
            </span>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-3 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-2 rounded-full bg-background/70 px-3 py-1.5 shadow-sm">
            <Layers3 className="h-4 w-4 text-primary" />
            Refresh-safe `/cmspanel/roles` list screen
          </span>
          <span className="inline-flex items-center gap-2 rounded-full bg-background/70 px-3 py-1.5 shadow-sm">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            Signed edit routes and permission-gated matrix
          </span>
        </div>
      </div>

      <div className="rounded-[28px] border border-border/60 bg-gradient-to-br from-muted/50 via-background to-background p-3 shadow-sm">
        <div className="grid gap-4 md:grid-cols-3">
          {summaryCards.map((card) => (
            <Card key={card.title} className="overflow-hidden rounded-2xl border-border/70 shadow-sm">
              <CardContent className="relative p-5">
                <div className={cn('pointer-events-none absolute inset-0 bg-gradient-to-br', card.accent)} />
                <div className="relative">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{card.title}</p>
                  <p className="mt-3 text-4xl font-semibold leading-none text-foreground">{card.value}</p>
                  <p className="mt-3 max-w-xs text-sm leading-6 text-muted-foreground">{card.description}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {isPlatformAdmin ? (
        <div className="space-y-4 rounded-2xl border border-border/60 bg-card/70 p-5 shadow-sm backdrop-blur-sm">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-foreground">Platform-Scope Role Cards</h3>
              <p className="text-sm text-muted-foreground">Global and privileged roles stay available here even when tenant-dependent role management is scoped to the current tenant.</p>
            </div>
            <div className="inline-flex items-center rounded-full border border-border/70 bg-background/70 px-3 py-1.5 text-xs font-medium text-muted-foreground">
              {platformRolesTotal} platform-scope roles
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {platformRolesLoading ? Array.from({ length: platformRolesPerPage }).map((_, index) => (
              <div key={index} className="h-44 animate-pulse rounded-2xl border border-border/60 bg-muted/40" />
            )) : platformRoles.map((role) => (
              <div key={role.id} className="rounded-2xl border border-border/60 bg-background/90 p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{role.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{role.description || t('common.not_set', 'Not set')}</p>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-500">
                    <Crown className="h-3 w-3 fill-amber-500 text-amber-500" />
                    Platform
                  </span>
                </div>

                <div className="mt-4 space-y-2 text-xs text-muted-foreground">
                  <div className="flex items-center justify-between gap-3">
                    <span>Scope</span>
                    <span className="font-medium text-foreground">{role.scope || 'platform'}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Tenant</span>
                    <span className="font-medium text-foreground">{role.tenant_id ? 'Tenant-bound' : 'Global'}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Access</span>
                    <span className="font-medium text-foreground">{role.is_full_access || role.is_platform_admin ? 'Elevated' : 'Managed'}</span>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-muted-foreground">Created {role.created_at ? new Date(role.created_at).toLocaleDateString() : '-'}</span>
                  <Button size="sm" variant="outline" className="rounded-xl" onClick={() => handleOpenRole(role)}>
                    Edit
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-3 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-muted-foreground">
              Showing {platformRoles.length === 0 ? 0 : ((platformRolesPage - 1) * platformRolesPerPage) + 1} to {Math.min(platformRolesPage * platformRolesPerPage, platformRolesTotal)} of {platformRolesTotal} platform-scope roles
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
                  <option key={value} value={value}>{value} / page</option>
                ))}
              </select>
              <Button variant="outline" className="rounded-xl" disabled={platformRolesPage <= 1} onClick={() => setPlatformRolesPage((page) => Math.max(1, page - 1))}>
                Previous
              </Button>
              <span className="px-2 text-sm text-muted-foreground">Page {platformRolesPage} of {platformRolesTotalPages}</span>
              <Button variant="outline" className="rounded-xl" disabled={platformRolesPage >= platformRolesTotalPages} onClick={() => setPlatformRolesPage((page) => Math.min(platformRolesTotalPages, page + 1))}>
                Next
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Tenant-Dependent Role Management</p>
          <p className="text-xs text-muted-foreground">{currentTenant?.name || (isPlatformAdmin ? 'Global scope' : 'Current tenant')}</p>
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
        {t('common.access_denied')}
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
