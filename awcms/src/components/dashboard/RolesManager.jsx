import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Crown, Layers3, Shield, ShieldCheck, Users2 } from 'lucide-react';
import GenericContentManager from '@/components/dashboard/GenericContentManager';
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
      onEditOverride={async (role) => {
        const routeId = await encodeRouteParam({ value: role.id, scope: 'roles.edit' });
        if (!routeId) {
          toast({ variant: 'destructive', title: t('common.error'), description: t('roles.errors.load_failed', 'Unable to open role editor.') });
          return;
        }
        navigate(`/cmspanel/roles/edit/${routeId}`);
      }}
    />
  );
}

export default RolesManager;
