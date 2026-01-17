
import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Save, X, User, Mail, Lock, Shield, Building } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';

import { usePermissions } from '@/contexts/PermissionContext';

function UserEditor({ user, onClose, onSave }) {
  const { toast } = useToast();
  const { tenantId: currentTenantId, isPlatformAdmin } = usePermissions();
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
    fetchRoles();
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
      setFormData(prev => ({ ...prev, tenant_id: currentTenantId || '' }));
    }
  }, [user, currentTenantId, isEditing]);

  const fetchRoles = async () => {
    const { data } = await supabase
      .from('roles')
      .select('id, name')
      .is('deleted_at', null)
      .order('name');
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
      const isGlobalRole = selectedRole && (selectedRole.name === 'owner' || selectedRole.name === 'super_admin');

      if (isGlobalRole) {
        // Clear tenant_id for global roles
        setFormData(prev => ({ ...prev, [name]: value, tenant_id: '' }));
        return;
      }
    }

    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (isEditing) {
        // Update existing user (Public Table Only)
        const updatePayload = {
          full_name: formData.full_name,
          role_id: formData.role_id,
          updated_at: new Date().toISOString()
        };
        // Platform Admin can change tenant (or set to null for global)
        if (isPlatformAdmin) {
          updatePayload.tenant_id = formData.tenant_id || null;
        }
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
        className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col"
      >
        <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
          <div>
            <h3 className="text-xl font-bold text-slate-900">
              {isEditing ? 'Edit User' : 'Create New User'}
            </h3>
            <p className="text-slate-500 text-xs mt-0.5">
              {isEditing ? 'Update user details and access level' : 'Add a new user to the system'}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full hover:bg-slate-200">
            <X className="w-5 h-5 text-slate-500" />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="space-y-2">
            <Label htmlFor="full_name" className="flex items-center gap-2 text-slate-700">
              <User className="w-4 h-4 text-slate-400" /> Full Name
            </Label>
            <Input
              id="full_name"
              name="full_name"
              value={formData.full_name}
              onChange={handleChange}
              placeholder="e.g. John Doe"
              required
              className="bg-white focus-visible:ring-blue-500"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email" className="flex items-center gap-2 text-slate-700">
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
              className={`bg-white focus-visible:ring-blue-500 ${isEditing ? 'bg-slate-100 text-slate-500 cursor-not-allowed' : ''}`}
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
                <Label htmlFor="inviteUser" className="text-sm font-medium text-slate-700 cursor-pointer">
                  Send email invitation (skip password)
                </Label>
              </div>

              {!inviteUser && (
                <div className="space-y-2">
                  <Label htmlFor="password" className="flex items-center gap-2 text-slate-700">
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
                    className="bg-white focus-visible:ring-blue-500"
                  />
                  <p className="text-xs text-slate-500">Must be at least 6 characters long.</p>
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="role_id" className="flex items-center gap-2 text-slate-700">
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
                  const excludedRoles = ['public', 'no_access'];
                  if (excludedRoles.includes(role.name)) return false;

                  // Security: Non-Platform Admins cannot assign Global Roles (owner, super_admin)
                  const globalRoles = ['owner', 'super_admin'];
                  if (!isPlatformAdmin && globalRoles.includes(role.name)) {
                    return false;
                  }

                  return true;
                })
                .map(role => (
                  <option key={role.id} value={role.id}>{role.name}</option>
                ))}
            </select>
          </div>

          {/* Tenant Selector - Shows for non-global roles (all except owner/super_admin) */}
          {(() => {
            const selectedRole = roles.find(r => r.id === formData.role_id);
            const isGlobalRole = selectedRole && (selectedRole.name === 'owner' || selectedRole.name === 'super_admin');

            // Don't show tenant selector for global roles (owner, super_admin)
            if (isGlobalRole) return null;

            // For tenant-scoped roles, always show and require tenant selection
            return (
              <div className="space-y-2">
                <Label htmlFor="tenant_id" className="flex items-center gap-2 text-slate-700">
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
        </form>

        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" disabled={loading} onClick={handleSubmit} className="bg-blue-600 hover:bg-blue-700">
            <Save className="w-4 h-4 mr-2" />
            {loading ? 'Saving...' : (isEditing ? 'Update User' : 'Create User')}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default UserEditor;
