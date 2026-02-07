
import React, { useState, useEffect } from 'react';
import ContentTable from '@/components/dashboard/ContentTable';
import RoleEditor from '@/components/dashboard/RoleEditor';
import { usePermissions } from '@/contexts/PermissionContext';
import { sanitizeHTML } from '@/utils/sanitize';
// Standard Permissions: tenant.role.read, tenant.role.create, tenant.role.update, tenant.role.delete
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';
import { Plus, Shield, RefreshCw, Trash2, Crown } from 'lucide-react';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';
import { useSearch } from '@/hooks/useSearch';
import MinCharSearchInput from '@/components/common/MinCharSearchInput';
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

import { useTenant } from '@/contexts/TenantContext';

function RolesManager() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { hasPermission, isPlatformAdmin } = usePermissions();
  const { currentTenant } = useTenant();

  // State declarations
  const [roles, setRoles] = useState([]);
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

  const [showEditor, setShowEditor] = useState(false);
  const [selectedRole, setSelectedRole] = useState(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [roleToDelete, setRoleToDelete] = useState(null);

  // Permission checks
  const canView = hasPermission('tenant.role.read');
  const canCreate = hasPermission('tenant.role.create');
  const canEdit = hasPermission('tenant.role.update');
  const canDelete = hasPermission('tenant.role.delete');

  useEffect(() => {
    fetchRoles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchRoles = async () => {
    setLoading(true);
    try {
      let dbQuery = supabase
        .from('roles')
        .select('*, owner:users!created_by(email), role_permissions(count), tenant:tenants(name)')
        .is('deleted_at', null)
        .order('created_at', { ascending: true });

      // Explicit Tenant Isolation (unless Platform Admin)
      if (!isPlatformAdmin && currentTenant?.id) {
        dbQuery = dbQuery.eq('tenant_id', currentTenant.id);
      }

      const { data, error } = await dbQuery;

      if (error) throw error;
      setRoles(data || []);
    } catch (err) {
      console.error(err);
      toast({ variant: 'destructive', title: t('common.error'), description: 'Failed to load roles' });
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (role) => {
    setSelectedRole(role);
    setShowEditor(true);
  };

  // Open delete confirmation dialog
  const openDeleteDialog = (role) => {
    if (role.is_system || role.is_platform_admin || role.is_full_access || role.is_public || role.is_guest) {
      toast({ variant: 'destructive', title: 'Protected Role', description: t('roles.errors.protected_role') });
      return;
    }
    setRoleToDelete(role);
    setDeleteDialogOpen(true);
  };

  // Execute the actual delete
  const handleConfirmDelete = async () => {
    if (!roleToDelete) return;

    setDeleteDialogOpen(false);
    setLoading(true);

    try {
      // Check if users are assigned
      const { count } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('role_id', roleToDelete.id);

      if (count > 0) {
        toast({ variant: 'destructive', title: t('common.error'), description: t('roles.errors.assigned_users', { count }) });
        return;
      }

      const { error } = await supabase
        .from('roles')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', roleToDelete.id);

      if (error) throw error;

      toast({ title: t('common.success'), description: t('common.move_to_trash_confirm', { resource: t('roles.title') }) });
      fetchRoles();
    } catch (err) {
      toast({ variant: 'destructive', title: t('common.error'), description: err.message });
    } finally {
      setLoading(false);
      setRoleToDelete(null);
    }
  };

  const filteredRoles = roles.filter(role => {
    if (!debouncedQuery) return true;
    const lower = debouncedQuery.toLowerCase();
    return role.name.toLowerCase().includes(lower) ||
      role.description?.toLowerCase().includes(lower);
  });

  const columns = [
    {
      key: 'name',
      label: t('roles.columns.name'),
      className: 'font-bold w-[200px]',
      render: (name, row) => (
        <div className="flex items-center gap-2">
          <Shield className={`w-4 h-4 ${row.is_full_access || row.is_platform_admin ? 'text-primary' : 'text-muted-foreground'}`} />
          {(row.is_platform_admin || row.is_full_access) && <Crown className="w-4 h-4 text-amber-500 fill-amber-500" />}
          <span>{name}</span>
          {(row.is_platform_admin || row.is_full_access) && (
            <span className="bg-primary/10 text-primary text-[10px] px-1.5 py-0.5 rounded-full uppercase font-bold border border-primary/20">
              {t('roles.badges.tenant_root')}
            </span>
          )}
        </div>
      )
    },
    { key: 'description', label: t('roles.columns.description'), className: 'text-muted-foreground' },
    {
      key: 'permissions_count',
      label: t('roles.columns.permissions'),
      className: 'text-center w-[120px]',
      render: (_, row) => {
        const count = row.role_permissions ? row.role_permissions[0]?.count : 0;
        if (row.is_full_access || row.is_platform_admin) {
          return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20">{t('roles.badges.all_access')} ({count || '∞'})</span>;
        }
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-secondary text-secondary-foreground">{count || 0} {t('roles.columns.permissions')}</span>;
      }
    },
    {
      key: 'owner',
      label: t('roles.columns.created_by'),
      className: 'text-muted-foreground text-xs',
      render: (_, row) => row.owner?.email || '-'
    }
  ];

  if (isPlatformAdmin) {
    columns.push({
      key: 'tenant_id',
      label: t('roles.columns.tenant'),
      className: 'text-xs text-slate-500',
      render: (tid, row) => row.tenant?.name || (tid ? 'Unknown Tenant' : t('common.global'))
    });
  }

  // Header actions for PageHeader
  const headerActions = (
    <div className="flex gap-2">
      <Button
        variant="outline"
        size="icon"
        onClick={fetchRoles}
        title={t('common.refresh')}
        className="h-10 w-10 border-slate-200/70 bg-white/70 hover:bg-white shadow-sm"
      >
        <RefreshCw className="w-4 h-4" />
      </Button>
      {canCreate && (
        <Button onClick={() => { setSelectedRole(null); setShowEditor(true); }} className="bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm">
          <Plus className="w-4 h-4 mr-2" /> {t('roles.create_role')}
        </Button>
      )}
    </div>
  );

  // Breadcrumbs for PageHeader
  const breadcrumbs = [{ label: t('roles.title'), icon: Shield }];

  if (!canView) return <div className="p-8 text-center text-slate-500">{t('common.access_denied')}</div>;

  return (
    <AdminPageLayout requiredPermission="tenant.role.read">
      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-red-500" />
              {t('roles.delete.title')}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p dangerouslySetInnerHTML={{ __html: sanitizeHTML(t('roles.delete.confirm', { name: roleToDelete?.name })) }} />
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-800 text-sm">
                  <p className="font-medium mb-1">⚠️ {t('common.error')}:</p>
                  <p>{t('roles.delete.warning_users')}</p>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
                  <p className="font-medium">🚫 {t('common.error')}:</p>
                  <p>{t('roles.delete.warning_restore')}</p>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              {t('common.move_to_trash')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {showEditor ? (
        <RoleEditor
          role={selectedRole}
          onClose={() => { setShowEditor(false); setSelectedRole(null); }}
          onSave={() => { setShowEditor(false); setSelectedRole(null); fetchRoles(); }}
        />
      ) : (
        <>
          <PageHeader
            title={t('roles.title')}
            description={t('roles.subtitle')}
            icon={Shield}
            breadcrumbs={breadcrumbs}
            actions={headerActions}
          />

          <div className="dashboard-surface dashboard-surface-hover overflow-hidden">
            <div className="p-4 border-b border-slate-200/60 bg-slate-50/70">
              <div className="max-w-sm">
                <MinCharSearchInput
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onClear={clearSearch}
                  loading={loading || searchLoading}
                  isValid={isSearchValid}
                  message={searchMessage}
                  minLength={minLength}
                  placeholder={t('common.search_resource', { resource: t('roles.title') })}
                />
              </div>
            </div>

            <ContentTable
              data={filteredRoles}
              columns={columns}
              loading={loading}
              onEdit={canEdit ? (role) => handleEdit(role) : null}
              onDelete={canDelete ? (role) => openDeleteDialog(role) : null}
            />
          </div>
        </>
      )}
    </AdminPageLayout>
  );
}

export default RolesManager;
