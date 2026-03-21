import { useState, useEffect, useCallback } from 'react';
import { Shield } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { usePermissions } from '@/contexts/PermissionContext';
import { useSearch } from '@/hooks/useSearch';
import ContentTable from '@/components/dashboard/ContentTable';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';
import PermissionsAccessDenied from '@/components/dashboard/permissions/PermissionsAccessDenied';
import PermissionsHeaderActions from '@/components/dashboard/permissions/PermissionsHeaderActions';
import PermissionsSearchPanel from '@/components/dashboard/permissions/PermissionsSearchPanel';
import PermissionEditorDialog from '@/components/dashboard/permissions/PermissionEditorDialog';
import PermissionDeleteDialog from '@/components/dashboard/permissions/PermissionDeleteDialog';

function PermissionsManager() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { isPlatformAdmin, isFullAccess, loading: permsLoading } = usePermissions();

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

  const [permissions, setPermissions] = useState([]);
  const [filteredPermissions, setFilteredPermissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingPermission, setEditingPermission] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [formData, setFormData] = useState({ name: '', description: '', resource: '', action: '' });

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  const isSuperAdmin = isPlatformAdmin || isFullAccess;

  const fetchPermissions = useCallback(async () => {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('permissions')
        .select('*')
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (error) throw error;

      setPermissions(data || []);
      setFilteredPermissions(data || []);
    } catch (error) {
      console.error('Fetch permissions error:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to fetch permissions.' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (!permsLoading) {
      if (isSuperAdmin) {
        fetchPermissions();
      } else {
        setLoading(false);
      }
    }
  }, [permsLoading, isSuperAdmin, fetchPermissions]);

  useEffect(() => {
    if (!debouncedQuery) {
      setFilteredPermissions(permissions);
    } else {
      const lower = debouncedQuery.toLowerCase();
      setFilteredPermissions(
        permissions.filter((permission) =>
          permission.name.toLowerCase().includes(lower)
          || (permission.description && permission.description.toLowerCase().includes(lower))
        )
      );
    }
  }, [debouncedQuery, permissions]);

  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedQuery]);

  const totalItems = filteredPermissions.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const paginatedPermissions = filteredPermissions.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const handleSave = async (event) => {
    event.preventDefault();

    try {
      const payload = {
        name: formData.name,
        description: formData.description,
        resource: formData.resource,
        action: formData.action,
        deleted_at: null,
        updated_at: new Date().toISOString(),
      };

      if (editingPermission) {
        const { error } = await supabase
          .from('permissions')
          .update(payload)
          .eq('id', editingPermission.id);
        if (error) throw error;
        toast({ title: 'Success', description: 'Permission updated' });
      } else {
        payload.created_at = new Date().toISOString();
        const { error } = await supabase
          .from('permissions')
          .insert([payload]);
        if (error) throw error;
        toast({ title: 'Success', description: 'Permission created' });
      }

      setIsEditorOpen(false);
      fetchPermissions();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    }
  };

  const handleRequestDelete = (permission) => {
    setDeleteTarget(permission);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;

    try {
      const targetId = typeof deleteTarget === 'string' ? deleteTarget : deleteTarget.id;
      const { error } = await supabase
        .from('permissions')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', targetId);
      if (error) throw error;

      toast({ title: 'Success', description: 'Permission moved to trash' });
      setDeleteTarget(null);
      fetchPermissions();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    }
  };

  const columns = [
    { key: 'name', label: t('permissions.columns.name'), className: 'font-semibold' },
    { key: 'resource', label: t('permissions.columns.resource'), className: 'text-muted-foreground' },
    { key: 'action', label: t('permissions.columns.action'), className: 'text-muted-foreground' },
    { key: 'description', label: t('permissions.columns.description') },
  ];

  if (!isSuperAdmin) {
    return <PermissionsAccessDenied />;
  }

  return (
    <AdminPageLayout requiredPermission="platform.permissions.read">
      <PageHeader
        title={t('permissions.manager.title')}
        description={t('permissions.manager.description')}
        icon={Shield}
        breadcrumbs={[{ label: t('permissions.manager.title'), icon: Shield }]}
        actions={(
          <PermissionsHeaderActions
            loading={loading}
            onRefresh={fetchPermissions}
            onCreate={() => {
              setEditingPermission(null);
              setFormData({ name: '', description: '', resource: '', action: '' });
              setIsEditorOpen(true);
            }}
          />
        )}
      />

      <PermissionsSearchPanel
        query={query}
        setQuery={setQuery}
        clearSearch={clearSearch}
        loading={loading}
        searchLoading={searchLoading}
        isSearchValid={isSearchValid}
        searchMessage={searchMessage}
        minLength={minLength}
      />

      <ContentTable
        data={paginatedPermissions}
        columns={columns}
        loading={loading}
        onEdit={(permission) => {
          setEditingPermission(permission);
          setFormData(permission);
          setIsEditorOpen(true);
        }}
        onDelete={handleRequestDelete}
        pagination={{
          currentPage,
          totalPages,
          totalItems,
          itemsPerPage,
          onPageChange: setCurrentPage,
          onLimitChange: (limit) => {
            setItemsPerPage(limit);
            setCurrentPage(1);
          },
        }}
      />

      <PermissionEditorDialog
        open={isEditorOpen}
        onOpenChange={setIsEditorOpen}
        editingPermission={editingPermission}
        formData={formData}
        setFormData={setFormData}
        onSave={handleSave}
      />

      <PermissionDeleteDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        permissionName={deleteTarget?.name}
        onConfirm={handleConfirmDelete}
      />
    </AdminPageLayout>
  );
}

export default PermissionsManager;
