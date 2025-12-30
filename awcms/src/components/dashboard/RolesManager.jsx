
import React, { useState, useEffect } from 'react';
import ContentTable from '@/components/dashboard/ContentTable';
import RoleEditor from '@/components/dashboard/RoleEditor';
import { usePermissions } from '@/contexts/PermissionContext';
// Standard Permissions: tenant.role.read, tenant.role.create, tenant.role.update, tenant.role.delete
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';
import { Plus, Shield, RefreshCw, Trash2, Crown } from 'lucide-react';
import { Input } from '@/components/ui/input';
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
  const { toast } = useToast();
  const { hasPermission, isPlatformAdmin } = usePermissions();
  const { currentTenant } = useTenant();

  // State declarations
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
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
  }, []);

  const fetchRoles = async () => {
    setLoading(true);
    try {
      let dbQuery = supabase
        .from('roles')
        .select('*, owner:users!created_by(email), role_permissions(count)')
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
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to load roles' });
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
    if (['owner', 'super_admin', 'admin', 'public', 'guest'].includes(role.name)) {
      toast({ variant: 'destructive', title: 'Protected Role', description: 'System roles cannot be deleted.' });
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
        toast({ variant: 'destructive', title: 'Cannot Delete', description: `There are ${count} users assigned to this role. Reassign them first.` });
        return;
      }

      const { error } = await supabase
        .from('roles')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', roleToDelete.id);

      if (error) throw error;

      toast({ title: 'Success', description: 'Role deleted successfully' });
      fetchRoles();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      setLoading(false);
      setRoleToDelete(null);
    }
  };

  const filteredRoles = roles.filter(role =>
    role.name.toLowerCase().includes(query.toLowerCase()) ||
    role.description?.toLowerCase().includes(query.toLowerCase())
  );

  const columns = [
    {
      key: 'name',
      label: 'Role Name',
      className: 'font-bold w-[200px]',
      render: (name) => (
        <div className="flex items-center gap-2">
          <Shield className={`w-4 h-4 ${['super_admin'].includes(name) ? 'text-purple-600' : 'text-slate-400'}`} />
          {name === 'owner' && <Crown className="w-4 h-4 text-amber-500 fill-amber-500" />}
          <span>{name}</span>
          {name === 'owner' && <span className="bg-amber-100 text-amber-700 text-[10px] px-1.5 py-0.5 rounded-full uppercase font-bold">Owner</span>}
          {name === 'super_admin' && <span className="bg-purple-100 text-purple-700 text-[10px] px-1.5 py-0.5 rounded-full uppercase font-bold">Tenant Root</span>}
        </div>
      )
    },
    { key: 'description', label: 'Description', className: 'text-slate-600' },
    {
      key: 'permissions_count',
      label: 'Permissions',
      className: 'text-center w-[120px]',
      render: (_, row) => {
        const count = row.role_permissions ? row.role_permissions[0]?.count : 0;
        if (['owner', 'super_admin'].includes(row.name)) {
          return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">ALL ACCESS ({count || '∞'})</span>;
        }
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-800">{count || 0} Permissions</span>;
      }
    },
    {
      key: 'owner',
      label: 'Created By',
      className: 'text-slate-500 text-xs',
      render: (_, row) => row.owner?.email || '-'
    }
  ];

  if (isPlatformAdmin) {
    columns.push({
      key: 'tenant_id',
      label: 'Tenant ID',
      className: 'text-xs text-slate-400 font-mono',
      render: (tid) => tid ? tid.slice(0, 8) + '...' : 'Global'
    });
  }

  if (!canView) return <div className="p-8 text-center text-slate-500">Access Denied</div>;

  return (
    <div className="space-y-6">
      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-red-500" />
              Delete Role
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Are you sure you want to delete the role <strong>"{roleToDelete?.name}"</strong>?
                </p>
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-800 text-sm">
                  <p className="font-medium mb-1">⚠️ Before deleting:</p>
                  <p>Ensure no users are currently assigned to this role. Users with this role will lose access.</p>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
                  <p className="font-medium">🚫 Warning:</p>
                  <p>This action is <strong>permanent</strong> and cannot be undone.</p>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete Permanently
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
          {/* Breadcrumb Navigation */}
          <nav className="flex items-center text-sm text-slate-500">
            <a href="/cmspanel" className="hover:text-blue-600 transition-colors flex items-center gap-1">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
              Dashboard
            </a>
            <svg className="w-4 h-4 mx-2 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            <span className="flex items-center gap-1 text-slate-700 font-medium">
              <Shield className="w-4 h-4" />
              Roles & Permissions
            </span>
          </nav>

          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <div>
              <h2 className="text-3xl font-bold text-slate-800 flex items-center gap-2">
                Roles & Permissions
              </h2>
              <p className="text-slate-500 mt-1">Manage access levels and configure granular permissions.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={fetchRoles} title="Refresh">
                <RefreshCw className="w-4 h-4" />
              </Button>
              {canCreate && (
                <Button onClick={() => { setSelectedRole(null); setShowEditor(true); }} className="bg-blue-600 hover:bg-blue-700">
                  <Plus className="w-4 h-4 mr-2" /> New Role
                </Button>
              )}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-100 bg-slate-50/50">
              <Input
                placeholder="Search roles..."
                value={query}
                onChange={e => setQuery(e.target.value)}
                className="max-w-sm bg-white"
              />
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
    </div>
  );
}

export default RolesManager;
