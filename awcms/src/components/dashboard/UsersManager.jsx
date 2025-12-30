import React, { useState, useEffect } from 'react';
import ContentTable from '@/components/dashboard/ContentTable';
import UserEditor from '@/components/dashboard/UserEditor';
import { usePermissions } from '@/contexts/PermissionContext';
// Standard Permissions: tenant.user.read, tenant.user.create, tenant.user.update, tenant.user.delete
import { useToast } from '@/components/ui/use-toast';
import { udm } from '@/lib/data/UnifiedDataManager'; // CHANGED: from supabase
import { supabase } from '@/lib/customSupabaseClient'; // Keep for Edge Functions if needed
import { Button } from '@/components/ui/button';
import { Plus, Search, RefreshCw, Home, ChevronRight, ShieldAlert, User, Trash2, Crown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Link } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
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
import UserApprovalManager from '@/components/dashboard/UserApprovalManager';

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

  const fetchUsers = async () => {
    if (!canView) return;
    setLoading(true);
    try {
      // CHANGED: Use UnifiedDataManager
      let q = udm.from('users')
        .select('*, roles!users_role_id_fkey(name), tenant:tenants(name)', { count: 'exact' })
        .is('deleted_at', null);

      // Strict Multi-Tenancy: Filter by tenant_id if not Platform Admin
      if (!isPlatformAdmin && currentTenant?.id) {
        q = q.eq('tenant_id', currentTenant.id);
      }

      if (query) {
        // UDM doesn't support .or() yet for remote passthrough efficiently in standard way without raw filter string support
        // For P1 offline, we used .ilike. 
        // Supabase .or is specific. 
        // Workaround: Search by email OR name is standard pattern.
        // We will default to email for now to simplify, or if we need OR support we should add to UDM.
        // Let's assume we search email for now to keep it safe, or try the raw filter if UDM supports it? 
        // UDM currently assumes array of filters ANDed.

        // Let's implement partial search on email
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
  };

  useEffect(() => {
    if (activeTab === 'users') {
      fetchUsers();
    }
  }, [currentPage, itemsPerPage, query, canView, activeTab]);

  const handleEdit = (user) => {
    setSelectedUser(user);
    setShowEditor(true);
  };

  const handleCreate = () => {
    setSelectedUser(null);
    setShowEditor(true);
  };

  const handleSave = () => {
    setShowEditor(false);
    setSelectedUser(null);
    fetchUsers();
  };

  // Open delete confirmation dialog
  const openDeleteDialog = (user) => {
    setUserToDelete(user);
    setDeleteDialogOpen(true);
  };

  // Execute the actual delete
  const handleConfirmDelete = async () => {
    if (!userToDelete) return;

    setLoading(true);
    setDeleteDialogOpen(false);

    try {
      // NOTE: Edge Function 'manage-users' handles Auth + DB deletion (soft or hard).
      // For Offline Architecture, we can't call Edge Function offline.
      // Ideally, we move this logic to 'delete user' in DB (soft delete) which syncs, 
      // and a background trigger handles Auth deletion.
      // BUT for P1, we keep the Edge Function for "Hard Delete" or "Auth Management" if online.

      // If Online: Use Edge Function (keeps current behavior)
      if (navigator.onLine) {
        const { data, error } = await supabase.functions.invoke('manage-users', {
          body: { action: 'delete', user_id: userToDelete.id }
        });

        if (error) throw error;
        if (data && data.error) throw new Error(data.error);
      } else {
        // If Offline: Soft Delete Locally
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
        if (!r?.name) return <span className="text-slate-400 text-xs">Guest</span>;
        if (r.name === 'owner') {
          return (
            <span className="flex items-center gap-1 bg-amber-100 px-2 py-1 rounded-full text-xs font-bold text-amber-700 border border-amber-200">
              <Crown className="w-3 h-3 fill-amber-500 text-amber-500" />
              OWNER
            </span>
          );
        }
        return (
          <span className="capitalize bg-slate-100 px-2 py-1 rounded-full text-xs font-medium text-slate-700">
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
        <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded-full text-xs font-medium">
          {item.tenant.name}
        </span>
      ) : <span className="text-slate-500 bg-slate-100 px-2 py-1 rounded-full text-xs font-medium">Global</span>
    }] : []),
    { key: 'created_at', label: 'Joined', type: 'date' }
  ];

  if (!canView) return (
    <div className="flex flex-col items-center justify-center min-h-[400px] bg-white rounded-xl border p-12 text-center">
      <ShieldAlert className="w-12 h-12 text-red-500 mb-4" />
      <h3 className="text-xl font-bold">Access Denied</h3>
      <p className="text-slate-500">You do not have permission to view users.</p>
    </div>
  );

  return (
    <div className="space-y-6">
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
                  <p>Please ensure the user's role has been changed to <strong>"No Access"</strong> or a role without permissions. Users with active permissions cannot be deleted.</p>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
                  <p className="font-medium">🚫 Warning:</p>
                  <p>This action is <strong>permanent</strong> and cannot be undone. All user data will be permanently removed from the system.</p>
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
        <UserEditor
          user={selectedUser}
          onClose={() => { setShowEditor(false); setSelectedUser(null); }}
          onSave={handleSave}
        />
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          {/* Breadcrumb Navigation */}
          <nav className="flex items-center text-sm text-slate-500 mb-6">
            <Link to="/cmspanel" className="hover:text-blue-600 transition-colors flex items-center gap-1">
              <Home className="w-4 h-4" />
              Dashboard
            </Link>
            <ChevronRight className="w-4 h-4 mx-2 text-slate-300" />
            <span className="flex items-center gap-1 text-slate-700 font-medium">
              <User className="w-4 h-4" />
              Users
            </span>
            {activeTab !== 'users' && (
              <>
                <ChevronRight className="w-4 h-4 mx-2 text-slate-300" />
                <span className="text-blue-600 font-medium">Registration Approvals</span>
              </>
            )}
          </nav>

          {/* Enhanced Tabs */}
          <div className="bg-white rounded-xl border border-slate-200 p-1.5 shadow-sm mb-6 inline-flex">
            <TabsList className="grid grid-cols-2 gap-1 bg-transparent p-0">
              <TabsTrigger
                value="users"
                className="flex items-center gap-2 px-6 py-2.5 rounded-lg data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-600 data-[state=active]:to-blue-700 data-[state=active]:text-white data-[state=active]:shadow-md transition-all duration-200 font-medium"
              >
                <User className="w-4 h-4" />
                Active Users
              </TabsTrigger>
              <TabsTrigger
                value="approvals"
                className="flex items-center gap-2 px-6 py-2.5 rounded-lg data-[state=active]:bg-gradient-to-r data-[state=active]:from-amber-500 data-[state=active]:to-amber-600 data-[state=active]:text-white data-[state=active]:shadow-md transition-all duration-200 font-medium"
              >
                <ShieldAlert className="w-4 h-4" />
                Approvals
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="users" className="space-y-6 mt-0">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <h2 className="text-3xl font-bold text-slate-800">Users</h2>
                <p className="text-slate-600">Manage user accounts and roles.</p>
              </div>
              {canCreate && (
                <Button onClick={handleCreate} className="bg-blue-600">
                  <Plus className="w-4 h-4 mr-2" /> New User
                </Button>
              )}
            </div>

            <div className="bg-white p-4 rounded-xl border shadow-sm flex items-center gap-2">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Search users..."
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              <div className="flex-1"></div>
              <Button variant="ghost" size="icon" onClick={fetchUsers} title="Refresh">
                <RefreshCw className="w-4 h-4 text-slate-500" />
              </Button>
            </div>

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
        </Tabs>
      )}
    </div>
  );
}

export default UsersManager;
