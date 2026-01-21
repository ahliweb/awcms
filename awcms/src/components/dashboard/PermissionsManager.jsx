
import React, { useState, useEffect, useCallback } from 'react';
import { Shield, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { usePermissions } from '@/contexts/PermissionContext';
import { useSearch } from '@/hooks/useSearch';
import MinCharSearchInput from '@/components/common/MinCharSearchInput';
import ContentTable from '@/components/dashboard/ContentTable';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';

function PermissionsManager() {
  const { toast } = useToast();
  const { userRole, loading: permsLoading } = usePermissions();

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

  const [permissions, setPermissions] = useState([]);
  const [filteredPermissions, setFilteredPermissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingPermission, setEditingPermission] = useState(null);
  const [formData, setFormData] = useState({ name: '', description: '', resource: '', action: '' });

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  const isSuperAdmin = ['super_admin', 'owner'].includes(userRole);

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
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to fetch permissions."
      });
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
      setFilteredPermissions(permissions.filter(p =>
        p.name.toLowerCase().includes(lower) ||
        (p.description && p.description.toLowerCase().includes(lower))
      ));
    }
  }, [debouncedQuery, permissions]);

  // Reset to page 1 on search
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedQuery]);

  // Pagination Logic
  const totalItems = filteredPermissions.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const paginatedPermissions = filteredPermissions.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        name: formData.name,
        description: formData.description,
        resource: formData.resource,
        action: formData.action,
        deleted_at: null,
        updated_at: new Date().toISOString()
      };

      if (editingPermission) {
        const { error } = await supabase
          .from('permissions')
          .update(payload)
          .eq('id', editingPermission.id);
        if (error) throw error;
        toast({ title: "Success", description: "Permission updated" });
      } else {
        payload.created_at = new Date().toISOString();
        const { error } = await supabase
          .from('permissions')
          .insert([payload]);
        if (error) throw error;
        toast({ title: "Success", description: "Permission created" });
      }
      setIsEditorOpen(false);
      fetchPermissions();
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: error.message });
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure? This might break role access.")) return;
    try {
      const { error } = await supabase
        .from('permissions')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
      toast({ title: "Success", description: "Permission moved to trash" });
      fetchPermissions();
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: error.message });
    }
  };

  const columns = [
    { key: 'name', label: 'Permission Name' },
    { key: 'resource', label: 'Resource' },
    { key: 'action', label: 'Action' },
    { key: 'description', label: 'Description' }
  ];

  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] bg-card rounded-xl border border-border p-12 text-center">
        <Shield className="w-12 h-12 text-destructive mb-4" />
        <h3 className="text-xl font-bold text-foreground">Access Restricted</h3>
        <p className="text-muted-foreground">Owner or Super Admin only.</p>
      </div>
    );
  }

  return (
    <AdminPageLayout requiredPermission="platform.permissions.read">
      <PageHeader
        title="Permissions"
        description="Manage system permissions"
        icon={Shield}
        breadcrumbs={[{ label: 'Permissions', icon: Shield }]}
        actions={(
          <Button onClick={() => {
            setEditingPermission(null);
            setFormData({ name: '', description: '', resource: '', action: '' });
            setIsEditorOpen(true);
          }} className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="w-4 h-4 mr-2" /> New Permission
          </Button>
        )}
      />

      <div className="bg-card p-4 rounded-xl border border-border shadow-sm">
        <MinCharSearchInput
          value={query}
          onChange={e => setQuery(e.target.value)}
          onClear={clearSearch}
          loading={loading || searchLoading}
          isValid={isSearchValid}
          message={searchMessage}
          minLength={minLength}
          placeholder="Search permissions"
        />
      </div>

      <ContentTable
        data={paginatedPermissions}
        columns={columns}
        loading={loading}
        onEdit={(perm) => {
          setEditingPermission(perm);
          setFormData(perm);
          setIsEditorOpen(true);
        }}
        onDelete={handleDelete}
        pagination={{
          currentPage,
          totalPages,
          totalItems,
          itemsPerPage,
          onPageChange: setCurrentPage,
          onLimitChange: (limit) => {
            setItemsPerPage(limit);
            setCurrentPage(1);
          }
        }}
      />

      <Dialog open={isEditorOpen} onOpenChange={setIsEditorOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingPermission ? 'Edit Permission' : 'New Permission'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <Label>Name (e.g. view_blogs)</Label>
              <Input value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Resource</Label>
                <Input value={formData.resource} onChange={e => setFormData({ ...formData, resource: e.target.value })} required />
              </div>
              <div>
                <Label>Action</Label>
                <Input value={formData.action} onChange={e => setFormData({ ...formData, action: e.target.value })} required />
              </div>
            </div>
            <div>
              <Label>Description</Label>
              <Input value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} />
            </div>
            <DialogFooter>
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AdminPageLayout>
  );
}

export default PermissionsManager;
