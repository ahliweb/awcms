import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Shield, Crown } from 'lucide-react';
import { AdminPageLayout } from '@/templates/flowbite-admin';
import GenericContentManager from '@/components/dashboard/GenericContentManager';
import { encodeRouteParam } from '@/lib/routeSecurity';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/contexts/PermissionContext';

function RolesManager() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();

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
        const count = row.role_permissions ? row.role_permissions[0]?.count : 0;
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
    <AdminPageLayout requiredPermission="tenant.role.read">
      <GenericContentManager
        tableName="roles"
        resourceName={t('roles.title')}
        columns={columns}
        permissionPrefix="role"
        customSelect="*, tenant:tenants(name), owner:users!roles_created_by_fkey(email), role_permissions(count)"
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
    </AdminPageLayout>
  );
}

export default RolesManager;
