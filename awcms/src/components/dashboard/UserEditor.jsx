
import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Save, X, User, Mail, Lock, Shield, Building } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';

import { usePermissions } from '@/contexts/PermissionContext';
import { useTenant } from '@/contexts/TenantContext';

function UserEditor({ user, onClose, onSave }) {
  const { toast } = useToast();
  const { tenantId: userTenantId, isPlatformAdmin } = usePermissions();
  const { currentTenant } = useTenant();
  const [loading, setLoading] = useState(false);
  const [roles, setRoles] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [inviteUser, setInviteUser] = useState(false);

  const [formData, setFormData] = useState({
    full_name: '',
    email: '',
    password: '',
    role_id: '',
    tenant_id: ''
  });

  const isEditing = !!user;

  useEffect(() => {
    fetchTenants(); // Always fetch tenants - visibility depends on role, not admin status
    if (isEditing) {
      setFormData({
        full_name: user.full_name || '',
        email: user.email || '',
        password: '', // Password not editable here for security
        role_id: user.role_id || '',
        tenant_id: user.tenant_id || ''
      });
    } else {
      // Default to current tenant for new users
      setFormData(prev => ({ ...prev, tenant_id: currentTenant?.id || userTenantId || '' }));
    }
  }, [user, currentTenant?.id, userTenantId, isEditing]);

  useEffect(() => {
    fetchRoles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTenant?.id, formData.tenant_id, isPlatformAdmin]);

  const resolveRoleTenantId = () => {
    const fallbackTenantId = currentTenant?.id || userTenantId || null;
    const selectedTenantId = formData.tenant_id === '' ? null : formData.tenant_id;

    if (isPlatformAdmin) {
      return selectedTenantId ?? null;
    }

    return selectedTenantId || fallbackTenantId;
  };

  const fetchRoles = async () => {
    const roleTenantId = resolveRoleTenantId();
    let query = supabase
      .from('roles')
      .select('id, name, scope, tenant_id, is_platform_admin, is_full_access, is_public, is_guest')
      .is('deleted_at', null)
      .order('name');

    if (roleTenantId) {
      if (isPlatformAdmin) {
        query = query.or(`tenant_id.eq.${roleTenantId},tenant_id.is.null`);
      } else {
        query = query.eq('tenant_id', roleTenantId);
      }
    } else {
      query = query.is('tenant_id', null);
    }

    const { data } = await query;
    if (data) setRoles(data);
  };

  const fetchTenants = async () => {
    const { data } = await supabase
      .from('tenants')
      .select('id, name')
      .is('deleted_at', null)
      .order('name');
    if (data) setTenants(data);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;

    // If role changes, check if it's a global role and clear tenant
    if (name === 'role_id') {
      const selectedRole = roles.find(r => r.id === value);
      const isGlobalRole = Boolean(selectedRole && (selectedRole.scope === 'platform' || selectedRole.is_platform_admin || selectedRole.is_full_access));

      if (isGlobalRole) {
        // Clear tenant_id for global roles
        setFormData(prev => ({ ...prev, [name]: value, tenant_id: '' }));
        return;
      }
    }

    if (name === 'tenant_id') {
      setFormData(prev => ({ ...prev, tenant_id: value, role_id: '' }));
      return;
    }

    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Check if selected role is a platform role
      const selectedRole = roles.find(r => r.id === formData.role_id);
      const isGlobalRole = Boolean(selectedRole && (selectedRole.scope === 'platform' || selectedRole.is_platform_admin || selectedRole.is_full_access));

      if (isEditing) {
        // Update existing user (Public Table Only)
        const updatePayload = {
          full_name: formData.full_name,
          role_id: formData.role_id,
          updated_at: new Date().toISOString()
        };

        // Always include tenant_id in update:
        // - For platform roles: set to null
        // - For tenant-scoped roles: use the selected tenant
        if (isGlobalRole) {
          updatePayload.tenant_id = null;
        } else if (formData.tenant_id) {
          updatePayload.tenant_id = formData.tenant_id;
        }

        console.log('Updating user with payload:', updatePayload);

        const { error } = await supabase
          .from('users')
          .update(updatePayload)
          .eq('id', user.id);

        if (error) throw error;

        toast({
          title: "Success",
          description: "User updated successfully"
        });
      } else {
        // Create new user (Requires Edge Function for Auth)
        if (!inviteUser && (!formData.password || formData.password.length < 6)) {
          throw new Error("Password is required and must be at least 6 characters");
        }

        console.log('Calling manage-users edge function with:', {
          action: inviteUser ? 'invite' : 'create',
          email: formData.email,
          full_name: formData.full_name,
          role_id: formData.role_id
        });

        const { data, error } = await supabase.functions.invoke('manage-users', {
          body: {
            action: inviteUser ? 'invite' : 'create',
            email: formData.email,
            password: inviteUser ? undefined : formData.password,
            full_name: formData.full_name,
            role_id: formData.role_id,
            tenant_id: formData.tenant_id || null // Pass null if empty (Global)
          }
        });

        console.log('Edge function response:', { data, error });

        if (error) {
          console.error('Edge function error details:', error);
          throw new Error(error.message || 'Failed to send a request to the Edge Function');
        }

        if (data && data.error) {
          console.error('Edge function returned error:', data.error);
          throw new Error(data.error);
        }

        toast({
          title: "Success",
          description: inviteUser ? "Invitation sent successfully" : "New user created successfully"
        });
      }
      onSave();
    } catch (error) {
      console.error('Error saving user:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to save user details"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto"
    >
      <motion.div
        initial={{ scale: 0.95, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col dark:bg-slate-900 dark:border dark:border-slate-800"
      >
        <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center bg-slate-50 dark:bg-slate-900/50 dark:border-slate-800">
          <div>
            <h3 className="text-xl font-bold text-slate-900 dark:text-white">
              {isEditing ? 'Edit User' : 'Create New User'}
            </h3>
            <p className="text-slate-500 text-xs mt-0.5 dark:text-slate-400">
              {isEditing ? 'Update user details and access level' : 'Add a new user to the system'}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full hover:bg-slate-200 dark:hover:bg-slate-800">
            <X className="w-5 h-5 text-slate-500 dark:text-slate-400" />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="space-y-2">
            <Label htmlFor="full_name" className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
              <User className="w-4 h-4 text-slate-400" /> Full Name
            </Label>
            <Input
              id="full_name"
              name="full_name"
              value={formData.full_name}
              onChange={handleChange}
              placeholder="e.g. John Doe"
              required
              className="bg-white focus-visible:ring-blue-500 dark:bg-slate-950 dark:border-slate-800 dark:text-white dark:placeholder-slate-500"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email" className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
              <Mail className="w-4 h-4 text-slate-400" /> Email Address
            </Label>
            <Input
              id="email"
              name="email"
              type="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="john@example.com"
              required
              disabled={isEditing}
              className={`bg-white focus-visible:ring-blue-500 dark:bg-slate-950 dark:border-slate-800 dark:text-white dark:placeholder-slate-500 ${isEditing ? 'bg-slate-100 text-slate-500 cursor-not-allowed dark:bg-slate-900 dark:text-slate-500' : ''}`}
            />
            {isEditing && <p className="text-xs text-slate-400">Email cannot be changed after creation.</p>}
          </div>

          {!isEditing && (
            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="inviteUser"
                  checked={inviteUser}
                  onChange={(e) => setInviteUser(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
                />
                <Label htmlFor="inviteUser" className="text-sm font-medium text-slate-700 cursor-pointer dark:text-slate-300">
                  Send email invitation (skip password)
                </Label>
              </div>

              {!inviteUser && (
                <div className="space-y-2">
                  <Label htmlFor="password" className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                    <Lock className="w-4 h-4 text-slate-400" /> Password
                  </Label>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    value={formData.password}
                    onChange={handleChange}
                    placeholder="••••••••"
                    required={!inviteUser}
                    minLength={6}
                    className="bg-white focus-visible:ring-blue-500 dark:bg-slate-950 dark:border-slate-800 dark:text-white dark:placeholder-slate-500"
                  />
                  <p className="text-xs text-slate-500 dark:text-slate-400">Must be at least 6 characters long.</p>
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="role_id" className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
              <Shield className="w-4 h-4 text-slate-400" /> Assign Role
            </Label>
            <select
              id="role_id"
              name="role_id"
              value={formData.role_id}
              onChange={handleChange}
              required
              className="flex h-10 w-full items-center justify-between rounded-md border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600"
            >
              <option value="" disabled>Select a role...</option>
              {roles
                .filter(role => {
                  // Exclude system roles that should not be assignable
                  if (role.is_public || role.is_guest) return false;

                  // Security: Non-Platform Admins cannot assign Platform Roles
                  if (!isPlatformAdmin && (role.scope === 'platform' || role.is_platform_admin || role.is_full_access)) {
                    return false;
                  }

                  return true;
                })
                .map(role => (
                  <option key={role.id} value={role.id}>{role.name}</option>
                ))}
            </select>
          </div>

          {/* Tenant Selector - Shows for tenant-scoped roles */}
          {(() => {
            const selectedRole = roles.find(r => r.id === formData.role_id);
            const isGlobalRole = Boolean(selectedRole && (selectedRole.scope === 'platform' || selectedRole.is_platform_admin || selectedRole.is_full_access));

            // Don't show tenant selector for platform roles
            if (isGlobalRole) return null;

            // For tenant-scoped roles, always show and require tenant selection
            return (
              <div className="space-y-2">
                <Label htmlFor="tenant_id" className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                  <Building className="w-4 h-4 text-slate-400" /> Assign Tenant
                  <span className="text-red-500 ml-1">*</span>
                </Label>
                <select
                  id="tenant_id"
                  name="tenant_id"
                  value={formData.tenant_id}
                  onChange={handleChange}
                  required
                  className="flex h-10 w-full items-center justify-between rounded-md border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600"
                >
                  <option value="" disabled>Select a tenant...</option>
                  {tenants.map(tenant => (
                    <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
                  ))}
                </select>
                <p className="text-xs text-slate-500">This role requires a tenant assignment.</p>
              </div>
            );
          })()}
          {/* Form Actions - Inside form for proper submit behavior */}
          <div className="pt-4 border-t border-slate-200 flex justify-end gap-3 dark:border-slate-800">
            <Button type="button" variant="ghost" onClick={onClose} disabled={loading} className="dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-800">
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="bg-blue-600 hover:bg-blue-700">
              <Save className="w-4 h-4 mr-2" />
              {loading ? 'Saving...' : (isEditing ? 'Update User' : 'Create User')}
            </Button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

export default UserEditor;
