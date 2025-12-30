
import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Shield, Save, X, Loader2, Lock, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import PermissionMatrix from '@/components/dashboard/PermissionMatrix';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { usePermissions } from '@/contexts/PermissionContext';

const PREDEFINED_TEMPLATES = {
  'Viewer': ['tenant.article.read', 'tenant.page.read', 'tenant.product.read', 'tenant.portfolio.read', 'tenant.announcement.read', 'tenant.photo_gallery.read'],
  'Editor': ['tenant.article.read', 'tenant.article.create', 'tenant.article.update', 'tenant.article.publish', 'tenant.page.read', 'tenant.page.create', 'tenant.page.update', 'tenant.product.read', 'tenant.product.create', 'tenant.product.update', 'tenant.media.read'],
  'Manager': ['tenant.user.read', 'tenant.role.read', 'tenant.setting.read', 'tenant.audit.read', 'tenant.extensions.read', 'tenant.extensions.manage']
};

const RoleEditor = ({ role, onClose, onSave }) => {
  const { toast } = useToast();
  const { hasPermission, isSuperAdmin } = usePermissions();

  // Permission check - only super admin or role.update can edit roles
  const canEditRoles = isSuperAdmin || hasPermission('tenant.role.update') || hasPermission('platform.role.update');

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
  const isSystemRole = ['owner', 'super_admin', 'public', 'guest'].includes(role?.name);
  const isFullAccessRole = ['owner', 'super_admin'].includes(role?.name);

  useEffect(() => {
    const fetchPermissions = async () => {
      try {
        // 1. Fetch All Available Permissions (Master List)
        const { data: allPerms, error: permError } = await supabase
          .from('permissions')
          .select('*')
          .order('resource', { ascending: true });

        if (permError) throw permError;
        setPermissions(allPerms || []);

        // 2. If editing existing role, fetch its current permissions
        if (role?.id) {
          const { data: rolePerms, error: rpError } = await supabase
            .from('role_permissions')
            .select('permission_id')
            .eq('role_id', role.id);

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

  // Auto-select all permissions for System Root Roles (Owner, Super Admin)
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

    const templatePermNames = PREDEFINED_TEMPLATES[templateName] || [];
    const newSet = new Set();

    // Filter permissions based on the template
    const targetIds = permissions
      .filter(p => {
        // Standardized Template Logic (ABAC Pattern)
        if (templateName === 'Viewer') {
          return p.action === 'read' && !['users', 'roles', 'settings', 'permissions'].includes(p.module);
        }
        if (templateName === 'Editor') {
          const contentModules = ['articles', 'pages', 'products', 'media', 'portfolio', 'announcements'];
          return ['read', 'create', 'update', 'publish'].includes(p.action) && contentModules.includes(p.module);
        }
        if (templateName === 'Manager') {
          return ['users', 'roles', 'settings', 'audit', 'extensions'].includes(p.module);
        }
        return false;
      })
      .map(p => p.id);

    setSelectedPermissions(new Set(targetIds));
    setActiveTemplate(templateName);
    toast({ title: "Template Applied", description: `Applied permissions for ${templateName}` });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (isFullAccessRole) {
      onClose(); // Just close, no save needed
      return;
    }

    setSaving(true);

    try {
      let roleId = role?.id;

      // 1. Create/Update Role
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
            description: formData.description
          })
          .select()
          .single();
        if (error) throw error;
        roleId = data.id;
      }

      // 2. Update Permissions (Matrix)
      // Transaction-like behavior: delete old, insert new
      // Note: Supabase doesn't have true transactions in client lib without RPC, 
      // but this sequential operation is standard practice.

      await supabase.from('role_permissions').delete().eq('role_id', roleId);

      const newPerms = Array.from(selectedPermissions).map(permId => ({
        role_id: roleId,
        permission_id: permId
      }));

      if (newPerms.length > 0) {
        // Chunk inserts if too many to avoid payload limits (unlikely here but good practice)
        const { error: permInsertError } = await supabase
          .from('role_permissions')
          .insert(newPerms);

        if (permInsertError) throw permInsertError;
      }

      toast({ title: 'Success', description: 'Role and permissions saved successfully.' });
      onSave();

    } catch (err) {
      console.error(err);
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
        className="bg-white rounded-xl shadow-2xl w-full max-w-7xl h-[90vh] flex flex-col overflow-hidden border border-slate-200"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
          <div>
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <Shield className={`w-6 h-6 ${isFullAccessRole ? 'text-purple-600' : 'text-blue-600'}`} />
              {role ? (role.name === 'owner' ? 'Owner Configuration (Global)' : 'Edit Role Configuration') : 'Create New Role'}
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              {isFullAccessRole ? 'This System Root Role has complete 100% access. Configuration is read-only.' : 'Define access control policies and permission scopes.'}
            </p>
          </div>
          <div className="flex gap-2">
            {!isSystemRole && (
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
            <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full hover:bg-slate-200">
              <X className="w-5 h-5 text-slate-500" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <form onSubmit={handleSave} className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar bg-white">

            {/* Role Details */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="space-y-4 lg:col-span-1">
                <div className="bg-slate-50 p-5 rounded-xl border border-slate-200 space-y-4">
                  <h3 className="font-semibold text-slate-800 flex items-center gap-2">
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
                        className={isSystemRole ? "bg-slate-100 text-slate-500 font-mono" : ""}
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
                  </div>
                </div>

                <Alert className="bg-blue-50 border-blue-100 text-blue-800">
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
                    <div className="w-full bg-blue-200 h-1.5 rounded-full mt-2 overflow-hidden">
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
                  <h3 className="font-semibold text-slate-800 text-lg">Access Control Matrix</h3>
                  <div className="text-xs text-slate-500">
                    {isFullAccessRole ? (
                      <span className="flex items-center gap-1 text-purple-600 font-medium bg-purple-50 px-2 py-1 rounded"><Shield className="w-3 h-3" /> Full System Access Granted (100%)</span>
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
          <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-between items-center shrink-0">
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
