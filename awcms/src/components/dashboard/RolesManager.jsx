
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
          <Shield className={`w-4 h-4 ${['super_admin'].includes(name) ? 'text-primary' : 'text-muted-foreground'}`} />
          {name === 'owner' && <Crown className="w-4 h-4 text-amber-500 fill-amber-500" />}
          <span>{name}</span>
          {name === 'owner' && <span className="bg-amber-500/10 text-amber-600 dark:text-amber-500 text-[10px] px-1.5 py-0.5 rounded-full uppercase font-bold border border-amber-500/20">Owner</span>}
          {name === 'super_admin' && <span className="bg-primary/10 text-primary text-[10px] px-1.5 py-0.5 rounded-full uppercase font-bold border border-primary/20">Tenant Root</span>}
        </div>
      )
    },
    { key: 'description', label: 'Description', className: 'text-muted-foreground' },
    {
      key: 'permissions_count',
      label: 'Permissions',
      className: 'text-center w-[120px]',
      render: (_, row) => {
        const count = row.role_permissions ? row.role_permissions[0]?.count : 0;
        if (['owner', 'super_admin'].includes(row.name)) {
          return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20">ALL ACCESS ({count || '∞'})</span>;
        }
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-secondary text-secondary-foreground">{count || 0} Permissions</span>;
      }
    },
    {
      key: 'owner',
      label: 'Created By',
      className: 'text-muted-foreground text-xs',
      render: (_, row) => row.owner?.email || '-'
    }
  ];

  if (isPlatformAdmin) {
    columns.push({
      key: 'tenant_id',
      label: 'Tenant Name',
      className: 'text-xs text-slate-500',
      render: (tid, row) => row.tenant?.name || (tid ? 'Unknown Tenant' : 'Global')
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
                  <p>This will move the role to trash. You can restore it if needed.</p>
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
              Move to Trash
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
          <nav className="flex items-center text-sm text-muted-foreground">
            <a href="/cmspanel" className="hover:text-foreground transition-colors flex items-center gap-1">
              <RefreshCw className="w-4 h-4" /> {/* Fallback icon, really should be Home but sticking to imports */}
              Dashboard
            </a>
            <span className="w-4 h-4 mx-2 text-muted" >/</span>
            <span className="flex items-center gap-1 text-foreground font-medium">
              <Shield className="w-4 h-4" />
              Roles & Permissions
            </span>
          </nav>

          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-card p-6 rounded-xl border border-border shadow-sm">
            <div>
              <h2 className="text-3xl font-bold text-foreground flex items-center gap-2">
                Roles & Permissions
              </h2>
              <p className="text-muted-foreground mt-1">Manage access levels and configure granular permissions.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={fetchRoles} title="Refresh" className="text-muted-foreground hover:text-foreground">
                <RefreshCw className="w-4 h-4" />
              </Button>
              {canCreate && (
                <Button onClick={() => { setSelectedRole(null); setShowEditor(true); }} className="bg-primary text-primary-foreground hover:bg-primary/90">
                  <Plus className="w-4 h-4 mr-2" /> New Role
                </Button>
              )}
            </div>
          </div>

          <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
            <div className="p-4 border-b border-border bg-muted/20">
              <Input
                placeholder="Search roles..."
                value={query}
                onChange={e => setQuery(e.target.value)}
                className="max-w-sm bg-background border-input"
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
