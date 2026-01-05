
import React, { useState, useEffect, useCallback } from 'react';
import ContentTable from '@/components/dashboard/ContentTable';
import UserEditor from '@/components/dashboard/UserEditor';
import UserApprovalManager from '@/components/dashboard/UserApprovalManager';
import { AdminPageLayout, PageHeader, PageTabs, TabsContent, NotAuthorized } from '@/templates/awadmintemplate01';
import { usePermissions } from '@/contexts/PermissionContext';
import { useToast } from '@/components/ui/use-toast';
import { udm } from '@/lib/data/UnifiedDataManager';
import { supabase } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';
import { Plus, Search, RefreshCw, User, ShieldAlert, Trash2, Crown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useTenant } from '@/contexts/TenantContext';
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

/**
 * UsersManager - Manages users and registration approvals.
 * Refactored to use awadmintemplate01 components for consistent UI.
 */
function UsersManager() {
  const { toast } = useToast();
  const { hasPermission, isPlatformAdmin } = usePermissions();
  const { currentTenant } = useTenant();

  // State declarations
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [totalItems, setTotalItems] = useState(0);
  const [showEditor, setShowEditor] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState(null);
  const [activeTab, setActiveTab] = useState('users');

  // Permission checks
  const canView = hasPermission('tenant.user.read');
  const canCreate = hasPermission('tenant.user.create');
  const canEdit = hasPermission('tenant.user.update');
  const canDelete = hasPermission('tenant.user.delete');

  // Tab definitions
  const tabs = [
    { value: 'users', label: 'Active Users', icon: User, color: 'blue' },
    { value: 'approvals', label: 'Approvals', icon: ShieldAlert, color: 'amber' },
  ];

  // Breadcrumbs
  const breadcrumbs = [
    { label: 'Users', href: activeTab !== 'users' ? '/cmspanel/users' : undefined, icon: User },
    ...(activeTab === 'approvals' ? [{ label: 'Registration Approvals' }] : []),
  ];

  // Actions for header
  const headerActions = canCreate ? [
    {
      label: 'New User',
      icon: Plus,
      onClick: () => { setSelectedUser(null); setShowEditor(true); },
      permission: 'tenant.user.create',
    },
  ] : [];

  const fetchUsers = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    try {
      let q = udm.from('users')
        .select('*, roles!users_role_id_fkey(name), tenant:tenants(name)', { count: 'exact' })
        .is('deleted_at', null);

      // Strict Multi-Tenancy
      if (!isPlatformAdmin && currentTenant?.id) {
        q = q.eq('tenant_id', currentTenant.id);
      }

      if (query) {
        q = q.ilike('email', `%${query}%`);
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
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to load users' });
    } finally {
      setLoading(false);
    }
  }, [canView, isPlatformAdmin, currentTenant, query, currentPage, itemsPerPage, toast]);

  useEffect(() => {
    if (activeTab === 'users') {
      fetchUsers();
    }
  }, [activeTab, fetchUsers]);

  const handleEdit = (user) => {
    setSelectedUser(user);
    setShowEditor(true);
  };

  const handleSave = () => {
    setShowEditor(false);
    setSelectedUser(null);
    fetchUsers();
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

      toast({ title: 'Success', description: 'User deleted successfully' });
      fetchUsers();
    } catch (err) {
      console.error('Delete error:', err);
      toast({
        variant: 'destructive',
        title: 'Delete Failed',
        description: err.message || 'Could not delete user'
      });
    } finally {
      setLoading(false);
      setUserToDelete(null);
    }
  };

  const columns = [
    { key: 'email', label: 'Email' },
    { key: 'full_name', label: 'Full Name' },
    {
      key: 'roles',
      label: 'Role',
      render: (r) => {
        if (!r?.name) return <span className="text-muted-foreground text-xs">Guest</span>;
        if (r.name === 'owner') {
          return (
            <span className="flex items-center gap-1 bg-amber-500/10 px-2 py-1 rounded-full text-xs font-bold text-amber-600 dark:text-amber-500 border border-amber-500/20">
              <Crown className="w-3 h-3 fill-amber-500 text-amber-500" />
              OWNER
            </span>
          );
        }
        return (
          <span className="capitalize bg-secondary px-2 py-1 rounded-full text-xs font-medium text-secondary-foreground">
            {r.name.replace('_', ' ')}
          </span>
        );
      }
    },
    // Tenant column - only for Platform Admins
    ...(isPlatformAdmin ? [{
      key: 'tenant',
      label: 'Tenant',
      render: (_, item) => item.tenant?.name ? (
        <span className="bg-primary/10 text-primary px-2 py-1 rounded-full text-xs font-medium border border-primary/20">
          {item.tenant.name}
        </span>
      ) : <span className="text-muted-foreground bg-muted px-2 py-1 rounded-full text-xs font-medium border border-border">Global</span>
    }] : []),
    { key: 'created_at', label: 'Joined', type: 'date' }
  ];

  if (showEditor) {
    return (
      <UserEditor
        user={selectedUser}
        onClose={() => { setShowEditor(false); setSelectedUser(null); }}
        onSave={handleSave}
      />
    );
  }

  return (
    <AdminPageLayout requiredPermission="tenant.user.read">
      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-red-500" />
              Delete User
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Are you sure you want to delete <strong>{userToDelete?.full_name || userToDelete?.email}</strong>?
                </p>
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-800 text-sm">
                  <p className="font-medium mb-1">⚠️ Before deleting:</p>
                  <p>Please ensure the user's role has been changed to <strong>"No Access"</strong> or a role without permissions.</p>
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
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-red-600 hover:bg-red-700">
              Delete Permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Page Header */}
      <PageHeader
        title="Users"
        description="Manage user accounts, roles, and registration approvals"
        icon={User}
        breadcrumbs={breadcrumbs}
        actions={activeTab === 'users' ? headerActions : []}
      />

      {/* Tabs Navigation */}
      <PageTabs value={activeTab} onValueChange={setActiveTab} tabs={tabs}>
        <TabsContent value="users" className="space-y-6 mt-0">
          {/* Search Bar */}
          <div className="bg-card p-4 rounded-xl border border-border shadow-sm flex items-center gap-2">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search users..."
                value={query}
                onChange={e => setQuery(e.target.value)}
                className="pl-9 bg-background"
              />
            </div>
            <div className="flex-1"></div>
            <Button variant="ghost" size="icon" onClick={fetchUsers} title="Refresh" className="text-muted-foreground hover:text-foreground">
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>

          {/* Users Table */}
          <ContentTable
            data={users}
            columns={columns}
            loading={loading}
            onEdit={canEdit ? handleEdit : null}
            onDelete={canDelete ? openDeleteDialog : null}
            pagination={{
              currentPage,
              totalPages: Math.ceil(totalItems / itemsPerPage),
              totalItems,
              itemsPerPage,
              onPageChange: setCurrentPage,
              onLimitChange: setItemsPerPage
            }}
          />
        </TabsContent>

        <TabsContent value="approvals" className="mt-0">
          <UserApprovalManager />
        </TabsContent>
      </PageTabs>
    </AdminPageLayout>
  );
}

export default UsersManager;
