
import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Shield, Save, X, Loader2, Lock, Info, CheckCircle2, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import PermissionMatrix from '@/components/dashboard/PermissionMatrix';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useTenant } from '@/contexts/TenantContext';

const RoleEditor = ({ role, onClose, onSave }) => {
  const { toast } = useToast();
  const { currentTenant } = useTenant();



  // Form State
  const [formData, setFormData] = useState({
    name: role?.name || '',
    description: role?.description || ''
  });

  // Permissions State
  const [permissions, setPermissions] = useState([]);
  const [selectedPermissions, setSelectedPermissions] = useState(new Set());

  // UI State
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTemplate, setActiveTemplate] = useState('');

  // Protect system roles
  const isSystemRole = Boolean(role?.is_system || role?.is_public || role?.is_guest);
  const isFullAccessRole = Boolean(role?.is_full_access || role?.is_platform_admin);
  const [syncingFullAccess, setSyncingFullAccess] = useState(false);

  useEffect(() => {
    const fetchPermissions = async () => {
      try {
        // 1. Fetch All Available Permissions (Master List)
        const { data: allPerms, error: permError } = await supabase
          .from('permissions')
          .select('*')
          .is('deleted_at', null)
          .order('resource', { ascending: true });

        if (permError) throw permError;
        setPermissions(allPerms || []);

        // 2. If editing existing role, fetch its current permissions
        if (role?.id) {
          const { data: rolePerms, error: rpError } = await supabase
            .from('role_permissions')
            .select('permission_id')
            .eq('role_id', role.id)
            .is('deleted_at', null);

          if (rpError) throw rpError;

          const permSet = new Set(rolePerms.map(rp => rp.permission_id));
          setSelectedPermissions(permSet);
        }
      } catch (err) {
        console.error("Error loading permission matrix:", err);
        toast({ variant: 'destructive', title: 'Error', description: 'Failed to load permissions' });
      } finally {
        setLoading(false);
      }
    };

    fetchPermissions();
  }, [role, toast]);

  // Auto-select all permissions for full-access roles
  useEffect(() => {
    if (isFullAccessRole && permissions.length > 0) {
      const allIds = new Set(permissions.map(p => p.id));
      setSelectedPermissions(allIds);
    }
  }, [isFullAccessRole, permissions]);

  const togglePermission = (permId) => {
    if (isFullAccessRole) return; // Cannot edit root admin permissions (they have all)

    setSelectedPermissions(prev => {
      const next = new Set(prev);
      if (next.has(permId)) {
        next.delete(permId);
      } else {
        next.add(permId);
      }
      return next;
    });
    setActiveTemplate(''); // Clear template selection if custom changes made
  };

  const applyTemplate = (templateName) => {
    if (isFullAccessRole) return;

    // Filter permissions based on the template
    const targetIds = permissions
      .filter(p => {
        // Standardized Template Logic (ABAC Pattern) - using resource column
        if (templateName === 'Viewer') {
          // Viewer: Read-only access to content, exclude admin resources
          const excludedResources = ['users', 'roles', 'settings', 'permissions', 'policies', 'platform', 'tenants', 'system'];
          return (p.action === 'read' || p.action === 'view') && !excludedResources.includes(p.resource);
        }
        if (templateName === 'Editor') {
          // Editor: Full content management (CRUD + publish) for content modules
          const contentResources = ['blogs', 'pages', 'products', 'files', 'photo_gallery', 'video_gallery',
            'portfolio', 'announcements', 'testimonies', 'promotions', 'galleries',
            'menus', 'categories', 'tags', 'visual_pages'];
          return ['read', 'view', 'create', 'update', 'edit', 'publish', 'delete', 'restore'].includes(p.action)
            && contentResources.includes(p.resource);
        }
        if (templateName === 'Manager') {
          // Manager: Full admin access (197 permissions)
          // Excludes: system/platform resources and specialized actions
          const excludedActions = ['permanent_delete', 'delete_permanent', 'view_public', 'soft_delete', 'manage', 'configure', 'comment', 'send', 'like', 'view_logs', 'view_readers'];
          const excludedResources = ['platform', 'tenant', 'tenants', 'system', '2fa', 'dashboard', 'content', 'tenant.region', 'orders'];
          return !excludedActions.includes(p.action) && !excludedResources.includes(p.resource);
        }
        return false;
      })
      .map(p => p.id);

    setSelectedPermissions(new Set(targetIds));
    setActiveTemplate(templateName);
    toast({ title: "Template Applied", description: `Applied permissions for ${templateName}` });
  };

  // Bulk action: Select All
  const selectAllPermissions = () => {
    if (isFullAccessRole) return;
    const allIds = new Set(permissions.map(p => p.id));
    setSelectedPermissions(allIds);
    setActiveTemplate('');
    toast({ title: "All Selected", description: `${permissions.length} permissions selected.` });
  };

  // Bulk action: Deselect All
  const deselectAllPermissions = () => {
    if (isFullAccessRole) return;
    setSelectedPermissions(new Set());
    setActiveTemplate('');
    toast({ title: "All Cleared", description: "All permissions deselected." });
  };

  // Sync Full Access: Persist all permissions for full-access roles to database
  const syncFullAccess = async () => {
    if (!isFullAccessRole || !role?.id) return;

    setSyncingFullAccess(true);
    try {
      // Soft-delete existing role_permissions
      await supabase
        .from('role_permissions')
        .update({ deleted_at: new Date().toISOString() })
        .eq('role_id', role.id)
        .is('deleted_at', null);

      // Insert all permissions for this role
      const allPerms = permissions.map(p => ({
        role_id: role.id,
        permission_id: p.id,
        deleted_at: null
      }));

      if (allPerms.length > 0) {
        const { error } = await supabase
          .from('role_permissions')
          .upsert(allPerms, { onConflict: 'role_id, permission_id' });

        if (error) throw error;
      }

      toast({ title: "Full Access Synced", description: `${permissions.length} permissions activated for ${role.name}.` });
    } catch (err) {
      console.error('Sync error:', err);
      toast({ variant: 'destructive', title: 'Sync Failed', description: err.message });
    } finally {
      setSyncingFullAccess(false);
    }
  };


  const handleSave = async (e) => {
    e.preventDefault();
    if (isFullAccessRole) {
      onClose(); // Just close, no save needed
      return;
    }

    setSaving(true);
    console.log('Starting save for role:', role?.name || formData.name);

    try {
      let roleId = role?.id;

      // 1. Create/Update Role Metadata
      if (roleId) {
        const { error } = await supabase
          .from('roles')
          .update({
            name: formData.name,
            description: formData.description,
            updated_at: new Date().toISOString()
          })
          .eq('id', roleId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('roles')
          .insert({
            name: formData.name,
            description: formData.description,
            tenant_id: currentTenant?.id || null,
            scope: currentTenant?.id ? 'tenant' : 'platform'
          })
          .select()
          .single();
        if (error) throw error;
        roleId = data.id;
      }

      console.log('Role ID secured:', roleId);

      // 2. Update Permissions (Matrix)
      // Standard pattern: Soft-delete all current permissions, then re-insert active ones.

      // A. Soft-delete all active permissions for this role
      const { error: deleteError } = await supabase
        .from('role_permissions')
        .update({ deleted_at: new Date().toISOString() })
        .eq('role_id', roleId)
        .is('deleted_at', null);

      if (deleteError) {
        console.error('Error clearing old permissions:', deleteError);
        throw deleteError;
      }

      // B. Insert/Restore selected permissions
      if (selectedPermissions.size > 0) {
        const newPerms = Array.from(selectedPermissions).map(permId => ({
          role_id: roleId,
          permission_id: permId,
          deleted_at: null
        }));

        console.log(`Saving ${newPerms.length} permissions...`);

        // Use upsert to handle potential race conditions or re-activation
        const { error: permInsertError } = await supabase
          .from('role_permissions')
          .upsert(newPerms, { onConflict: 'role_id, permission_id', ignoreDuplicates: false });

        if (permInsertError) {
          console.error('Error inserting permissions:', permInsertError);
          throw permInsertError;
        }
      }

      toast({ title: 'Success', description: 'Role and permissions saved successfully.' });
      onSave();

    } catch (err) {
      console.error('Save failed:', err);
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-slate-900/40 z-[100] flex items-center justify-center p-4 backdrop-blur-sm"
    >
      <motion.div
        initial={{ scale: 0.95, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-[95vw] xl:max-w-[1600px] h-[92vh] flex flex-col overflow-hidden border border-slate-200 dark:border-slate-700"
      >
        {/* Header */}
        <div className="px-6 py-3 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-800 shrink-0">
          <div>
            <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <Shield className={`w-5 h-5 ${isFullAccessRole ? 'text-purple-600' : 'text-blue-600'}`} />
              {role ? (role.scope === 'platform' ? 'Platform Role Configuration' : 'Edit Role Configuration') : 'Create New Role'}
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              {isFullAccessRole ? 'This System Root Role has complete 100% access. Configuration is read-only.' : 'Define access control policies and permission scopes.'}
            </p>
          </div>
          <div className="flex gap-2">
            {/* Bulk Actions for non-system roles */}
            {!isSystemRole && (
              <div className="hidden md:flex bg-white rounded-lg border border-slate-200 p-1 mr-2">
                <button
                  type="button"
                  onClick={selectAllPermissions}
                  className="px-2 py-1 text-xs font-medium rounded-md text-green-600 hover:bg-green-50 flex items-center gap-1"
                >
                  <CheckCircle2 className="w-3 h-3" /> All
                </button>
                <button
                  type="button"
                  onClick={deselectAllPermissions}
                  className="px-2 py-1 text-xs font-medium rounded-md text-slate-600 hover:bg-slate-100 flex items-center gap-1"
                >
                  <X className="w-3 h-3" /> None
                </button>
              </div>
            )}
            {!isFullAccessRole && (
              <div className="hidden md:flex bg-white rounded-lg border border-slate-200 p-1 mr-4">
                {['Viewer', 'Editor', 'Manager'].map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => applyTemplate(t)}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${activeTemplate === t ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}
                  >
                    {t} Set
                  </button>
                ))}
              </div>
            )}
            {/* Sync Full Access button for full-access roles */}
            {isFullAccessRole && (
              <Button
                type="button"
                onClick={syncFullAccess}
                disabled={syncingFullAccess}
                className="bg-purple-600 hover:bg-purple-700 text-white mr-2"
              >
                {syncingFullAccess ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Syncing...</>
                ) : (
                  <><Zap className="w-4 h-4 mr-2" /> Sync Full Access</>
                )}
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full hover:bg-slate-200">
              <X className="w-5 h-5 text-slate-500" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <form onSubmit={handleSave} className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar bg-white dark:bg-slate-900">

            {/* Role Details */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="space-y-4 lg:col-span-1">
                <div className="bg-slate-50 dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700 space-y-4">
                  <h3 className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                    <Info className="w-4 h-4 text-blue-500" /> Role Details
                  </h3>

                  <div className="space-y-3">
                    <div className="space-y-1">
                      <Label htmlFor="name">Role Name <span className="text-red-500">*</span></Label>
                      <Input
                        id="name"
                        value={formData.name}
                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                        placeholder="e.g. Content Editor"
                        required
                        disabled={isSystemRole}
                        className={isSystemRole ? "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 font-mono" : "dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600"}
                      />
                      {isSystemRole && <p className="text-[10px] text-amber-600 flex items-center gap-1 mt-1"><Lock className="w-3 h-3" /> System role name cannot be changed.</p>}
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="description">Description</Label>
                      <Textarea
                        id="description"
                        value={formData.description}
                        onChange={e => setFormData({ ...formData, description: e.target.value })}
                        placeholder="Describe the purpose and access level of this role..."
                        rows={3}
                      />
                    </div>

                    {/* Hierarchy Reference */}
                    <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
                      <p className="text-xs font-medium text-slate-500 mb-2">Tenant Staff Hierarchy Reference (Levels 1-10)</p>
                      <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[10px] text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700/50 p-2 rounded border border-slate-200 dark:border-slate-700">
                        <div>10: Super Manager</div>
                        <div>9: Senior Manager</div>
                        <div>8: Manager</div>
                        <div>7: Senior Supervisor</div>
                        <div>6: Supervisor</div>
                        <div>5: Senior Specialist</div>
                        <div>4: Specialist</div>
                        <div>3: Associate</div>
                        <div>2: Assistant</div>
                        <div>1: Internship</div>
                      </div>
                    </div>
                  </div>
                </div>

                <Alert className="bg-blue-50 dark:bg-blue-950/30 border-blue-100 dark:border-blue-900 text-blue-800 dark:text-blue-200">
                  <Info className="w-4 h-4 text-blue-600" />
                  <AlertTitle>Permission Stats</AlertTitle>
                  <AlertDescription className="text-xs mt-1">
                    <div className="flex justify-between items-center mt-2">
                      <span>Granted:</span>
                      <span className="font-mono font-bold">{isFullAccessRole ? 'ALL' : selectedPermissions.size}</span>
                    </div>
                    <div className="flex justify-between items-center mt-1">
                      <span>Total Available:</span>
                      <span className="font-mono">{permissions.length}</span>
                    </div>
                    <div className="w-full bg-blue-200 dark:bg-blue-900 h-1.5 rounded-full mt-2 overflow-hidden">
                      <div
                        className="bg-blue-600 h-full transition-all duration-500"
                        style={{ width: `${isFullAccessRole ? 100 : (permissions.length ? (selectedPermissions.size / permissions.length) * 100 : 0)}%` }}
                      />
                    </div>
                  </AlertDescription>
                </Alert>
              </div>

              <div className="lg:col-span-2 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-slate-800 dark:text-slate-200 text-lg">Access Control Matrix</h3>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {isFullAccessRole ? (
                      <span className="flex items-center gap-1 text-purple-600 dark:text-purple-400 font-medium bg-purple-50 dark:bg-purple-900/40 px-2 py-1 rounded"><Shield className="w-3 h-3" /> Full System Access Granted (100%)</span>
                    ) : (
                      <span>Configure modular permissions below</span>
                    )}
                  </div>
                </div>

                {loading ? (
                  <div className="h-64 flex flex-col items-center justify-center border rounded-xl border-dashed bg-slate-50">
                    <Loader2 className="w-8 h-8 text-blue-600 animate-spin mb-2" />
                    <span className="text-slate-500 text-sm">Loading permissions matrix...</span>
                  </div>
                ) : (
                  <PermissionMatrix
                    permissions={permissions}
                    selectedPermissions={selectedPermissions}
                    onToggle={togglePermission}
                    readOnly={isFullAccessRole}
                  />
                )}
              </div>
            </div>

          </div>

          {/* Footer Actions */}
          <div className="p-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex justify-between items-center shrink-0">
            <div className="text-xs text-slate-400 hidden sm:block">
              Last updated: {new Date().toLocaleDateString()}
            </div>
            <div className="flex gap-3 w-full sm:w-auto justify-end">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              {!isFullAccessRole && (
                <Button type="submit" disabled={saving || loading} className="bg-slate-900 hover:bg-slate-800 text-white min-w-[120px]">
                  {saving ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</>
                  ) : (
                    <><Save className="w-4 h-4 mr-2" /> Save Configuration</>
                  )}
                </Button>
              )}
            </div>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
};

export default RoleEditor;
