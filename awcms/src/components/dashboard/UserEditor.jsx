import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Save, X, User, Mail, Shield, Building, Phone, MapPin, Globe, Briefcase, Flag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { encodeRouteParam } from '@/lib/routeSecurity';
import useSecureRouteParam from '@/hooks/useSecureRouteParam';
import useSplatSegments from '@/hooks/useSplatSegments';
import { useAuth } from '@/contexts/SupabaseAuthContext';

import { usePermissions } from '@/contexts/PermissionContext';
import { useTenant } from '@/contexts/TenantContext';

function UserEditor({ user, onClose, onSave }) {
  const { toast } = useToast();
  const { tenantId: userTenantId, isPlatformAdmin, hasPermission, isFullAccess } = usePermissions();
  const { currentTenant } = useTenant();
  const navigate = useNavigate();
  const { id: routeParam } = useParams();
  const segments = useSplatSegments();
  const { session } = useAuth();
  const { value: routeUserId, loading: routeLoading, isLegacy } = useSecureRouteParam(routeParam, 'users.edit');
  const [resolvedUser, setResolvedUser] = useState(user || null);
  const userData = user || resolvedUser;
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);

  const [roles, setRoles] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [inviteUser, setInviteUser] = useState(false);

  // Helper to check if user can manage admin fields
  const canManageAdminFields = hasPermission('tenant.user.update') || isPlatformAdmin || isFullAccess;
  const allowedTabs = canManageAdminFields ? ['account', 'profile', 'admin'] : ['account', 'profile'];
  const hasTabSegment = segments.length > 0 && allowedTabs.includes(segments[0]);
  const activeTab = hasTabSegment ? segments[0] : 'account';
  const baseEditPath = routeParam ? `/cmspanel/users/edit/${routeParam}` : null;

  // Account Data (Existing)
  const [formData, setFormData] = useState({
    full_name: '',
    email: '',
    password: '',
    role_id: '',
    tenant_id: ''
  });

  // Profile Data (New)
  const [profileData, setProfileData] = useState({
    job_title: '',
    department: '',
    phone: '',
    location: '',
    website_url: '',
    linkedin_url: '',
    twitter_url: '',
    github_url: '',
    description: ''
  });

  // Admin Data (New)
  const [adminData, setAdminData] = useState({
    admin_notes: '',
    admin_flags: ''
  });

  const isEditing = Boolean(userData || routeUserId);

  const handleClose = () => {
    if (onClose) {
      onClose();
      return;
    }
    navigate('/cmspanel/users');
  };

  useEffect(() => {
    const fetchUser = async () => {
      if (user) {
        setResolvedUser(user);
        return;
      }
      if (!routeUserId) return;
      try {
        setFetching(true);
        const { data, error } = await supabase
          .from('users')
          .select('*')
          .eq('id', routeUserId)
          .single();

        if (error) throw error;
        setResolvedUser(data || null);
      } catch (error) {
        console.error('Error loading user:', error);
        toast({ variant: 'destructive', title: 'Error', description: 'Failed to load user details.' });
        navigate('/cmspanel/users');
      } finally {
        setFetching(false);
      }
    };

    fetchUser();
  }, [user, routeUserId, toast, navigate]);

  useEffect(() => {
    if (!routeParam || routeLoading) return;
    if (!routeUserId) {
      toast({ variant: 'destructive', title: 'Error', description: 'Invalid user link.' });
      navigate('/cmspanel/users');
      return;
    }
    if (!isLegacy) return;
    const redirectLegacy = async () => {
      const signedId = await encodeRouteParam({ value: routeUserId, scope: 'users.edit' });
      if (!signedId || signedId === routeParam) return;
      navigate(`/cmspanel/users/edit/${signedId}`, { replace: true });
    };
    redirectLegacy();
  }, [routeParam, routeLoading, routeUserId, isLegacy, navigate, toast]);

  useEffect(() => {
    if (!baseEditPath) return;
    if (segments.length === 0) return;
    if (!hasTabSegment) {
      navigate(baseEditPath, { replace: true });
    }
  }, [baseEditPath, segments, hasTabSegment, navigate]);

  // Initialize Data
  useEffect(() => {
    fetchTenants(); // Always fetch tenants
    fetchRoles();   // Always fetch roles
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTenant?.id, formData.tenant_id, isPlatformAdmin]);

  // Load User Data on Edit
  useEffect(() => {
    if (isEditing && userData) {
      // 1. Set Account Data
      setFormData({
        full_name: userData.full_name || '',
        email: userData.email || '',
        password: '',
        role_id: userData.role_id || '',
        tenant_id: userData.tenant_id || ''
      });

      // 2. Fetch Profile & Admin Data
      const fetchExtendedData = async () => {
        setFetching(true);
        try {
          // Fetch Profile
          const { data: profile, error: profileError } = await supabase
            .from('user_profiles')
            .select('*')
            .eq('user_id', userData.id)
            .maybeSingle();

          if (!profileError && profile) {
            setProfileData({
              job_title: profile.job_title || '',
              department: profile.department || '',
              phone: profile.phone || '',
              location: profile.location || '',
              website_url: profile.website_url || '',
              linkedin_url: profile.linkedin_url || '',
              twitter_url: profile.twitter_url || '',
              github_url: profile.github_url || '',
              description: profile.description || ''
            });
          }

          // Fetch Admin Fields if allowed
          if (canManageAdminFields) {
            const { data: adminFields, error: adminError } = await supabase
              .rpc('get_user_profile_admin_fields', { p_user_id: userData.id });

            if (!adminError && adminFields && adminFields.length > 0) {
              // RPC returns an array
              const fields = adminFields[0];
              setAdminData({
                admin_notes: fields.admin_notes || '',
                admin_flags: fields.admin_flags || ''
              });
            }
          }
        } catch (error) {
          console.error("Error fetching user details:", error);
          toast({
            variant: "destructive",
            title: "Error loading details",
            description: "Some profile information could not be loaded."
          });
        } finally {
          setFetching(false);
        }
      };

      fetchExtendedData();
    } else {
      // Default to current tenant for new users
      setFormData(prev => ({ ...prev, tenant_id: currentTenant?.id || userTenantId || '' }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userData, isEditing, currentTenant?.id, userTenantId]);

  const resolveRoleTenantId = () => {
    const fallbackTenantId = currentTenant?.id || userTenantId || null;
    const selectedTenantId = formData.tenant_id === '' ? null : formData.tenant_id;
    if (isPlatformAdmin) return selectedTenantId ?? null;
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
    const { data } = await supabase.from('tenants').select('id, name').is('deleted_at', null).order('name');
    if (data) setTenants(data);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === 'role_id') {
      const selectedRole = roles.find(r => r.id === value);
      const isGlobalRole = Boolean(selectedRole && (selectedRole.scope === 'platform' || selectedRole.is_platform_admin || selectedRole.is_full_access));
      if (isGlobalRole) {
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

  const handleProfileChange = (e) => {
    const { name, value } = e.target;
    setProfileData(prev => ({ ...prev, [name]: value }));
  };

  const handleAdminChange = (e) => {
    const { name, value } = e.target;
    setAdminData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (!session) {
        throw new Error('Your session expired. Please sign in again.');
      }

      const selectedRole = roles.find(r => r.id === formData.role_id);
      const isGlobalRole = Boolean(selectedRole && (selectedRole.scope === 'platform' || selectedRole.is_platform_admin || selectedRole.is_full_access));

      if (!isGlobalRole && !formData.tenant_id) {
        throw new Error('Tenant is required for non-platform roles.');
      }

      let userId = userData?.id;

      // 1. Create or Update Core User (Auth & Users Table)
      if (isEditing) {
        // Update existing user (Public Table Only)
        const updatePayload = {
          full_name: formData.full_name,
          role_id: formData.role_id,
          updated_at: new Date().toISOString()
        };

        if (isGlobalRole) updatePayload.tenant_id = null;
        else if (formData.tenant_id) updatePayload.tenant_id = formData.tenant_id;

        const { error: userError } = await supabase
          .from('users')
          .update(updatePayload)
          .eq('id', userData.id);

        if (userError) throw userError;
      } else {
        // Create new user (Edge Function)
        if (!inviteUser && (!formData.password || formData.password.length < 6)) {
          throw new Error("Password is required and must be at least 6 characters");
        }

        let edgeResponse = await supabase.functions.invoke('manage-users', {
          body: {
            action: inviteUser ? 'invite' : 'create',
            email: formData.email,
            password: inviteUser ? undefined : formData.password,
            full_name: formData.full_name,
            role_id: formData.role_id,
            tenant_id: formData.tenant_id || null
          }
        });

        const isUnauthorized = edgeResponse?.error?.context?.status === 401;
        const hasLocalSecret = Boolean(import.meta.env.DEV && import.meta.env.VITE_SUPABASE_SECRET_KEY);

        if (isUnauthorized && hasLocalSecret) {
          edgeResponse = await supabase.functions.invoke('manage-users', {
            headers: {
              Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_SECRET_KEY}`,
            },
            body: {
              action: inviteUser ? 'invite' : 'create',
              email: formData.email,
              password: inviteUser ? undefined : formData.password,
              full_name: formData.full_name,
              role_id: formData.role_id,
              tenant_id: formData.tenant_id || null
            }
          });
        }

        const { data, error: edgeError } = edgeResponse;

        if (edgeError || (data && data.error)) {
          throw new Error(edgeError?.message || data?.error || 'Failed to create user');
        }

        // Setup userId if returned, otherwise we might stop here for new users
        // Assuming Edge Function returns the new user object or ID
        // If data.user exists
        if (data?.user?.id) {
          userId = data.user.id;
        }
      }

      // 2. Upsert Profile & Admin Data (Only if we have a userId)
      // Note: For new users, if the EF didn't return an ID, we skip this.
      // But typically we want to save profile data too.
      // If creating a user, better to just let them fill profile later or do it in a second pass.
      // For now, only proceed if userId is available (always true for edit)

      const resolvedTenantId = formData.tenant_id || userData?.tenant_id || null;

      if (userId && resolvedTenantId) {
        // 2. Upsert Profile Data
        // Fix: user_profiles RLS might require tenant_id to be set if the RLS checks for it
        const profilePayload = {
          user_id: userId,
          ...profileData,
          tenant_id: resolvedTenantId
        };
        // Remove empty strings if they cause issues? No, standard text fields.

        const { error: profileError } = await supabase
          .from('user_profiles')
          .upsert(profilePayload, { onConflict: 'user_id' });

        if (profileError) {
          console.error("Error updating profile:", profileError);
          // Don't throw for partial failure, just warn
          toast({ variant: "destructive", title: "Warning", description: "User basic info saved, but profile details failed." });
        }

        // 3. Update Admin Data (RPC)
        if (canManageAdminFields) {
          const { error: adminRpcError } = await supabase
            .rpc('set_user_profile_admin_fields', {
              p_user_id: userId,
              p_admin_notes: adminData.admin_notes,
              p_admin_flags: adminData.admin_flags
            });

          if (adminRpcError) {
            console.error("Error updating admin fields:", adminRpcError);
            toast({ variant: "destructive", title: "Warning", description: "User saved, but admin fields failed." });
          }
        }
      } else if (userId && !resolvedTenantId) {
        toast({ title: 'Info', description: 'User created without tenant context. Admin profile fields were skipped.' });
      }

      toast({
        title: "Success",
        description: isEditing ? "User updated successfully" : "User created successfully"
      });
      if (onSave) {
        onSave();
      } else {
        navigate('/cmspanel/users');
      }
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto"
    >
      <motion.div
        initial={{ scale: 0.95, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col border border-slate-200 dark:bg-slate-950 dark:border-slate-800 h-[85vh]"
      >
        <div className="px-6 py-5 border-b border-slate-200 flex justify-between items-center bg-slate-50 dark:bg-slate-900 shrink-0">
          <div>
            <h3 className="text-xl font-bold text-slate-900 dark:text-white">
              {isEditing ? 'Edit User Details' : 'Create New User'}
            </h3>
            <p className="text-slate-500 text-xs mt-0.5 dark:text-slate-400">
              {isEditing ? 'Manage account, profile, and admin settings' : 'Add a new user to the system'}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={handleClose} className="rounded-full hover:bg-slate-200/70 dark:hover:bg-slate-800">
            <X className="w-5 h-5 text-slate-500 dark:text-slate-400" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-0 flex flex-col min-h-0">
          {/* If creating new user, keep it simple no tabs necessary for step 1 */}
          {!isEditing ? (
            <div className="p-6 overflow-y-auto">
              <AccountForm
                formData={formData}
                handleChange={handleChange}
                roles={roles}
                tenants={tenants}
                isPlatformAdmin={isPlatformAdmin}
                inviteUser={inviteUser}
                setInviteUser={setInviteUser}
                isEditing={false}
              />
            </div>
          ) : (
            <Tabs
              value={activeTab}
              onValueChange={(value) => {
                if (!baseEditPath) return;
                if (value === 'account') {
                  navigate(baseEditPath);
                } else {
                  navigate(`${baseEditPath}/${value}`);
                }
              }}
              className="w-full flex-1 flex flex-col min-h-0"
            >
              <div className="px-6 pt-4 shrink-0 bg-white dark:bg-slate-950 z-10">
                <TabsList className="w-full justify-start h-11 bg-slate-100/50 dark:bg-slate-900/50 p-1">
                  <TabsTrigger value="account" className="flex-1">Account</TabsTrigger>
                  <TabsTrigger value="profile" className="flex-1">Profile</TabsTrigger>
                  {canManageAdminFields && <TabsTrigger value="admin" className="flex-1">Admin</TabsTrigger>}
                </TabsList>
              </div>

              <div className="flex-1 overflow-y-auto p-6 min-h-0">
                <TabsContent value="account" className="mt-0 space-y-6 h-full">
                  <AccountForm
                    formData={formData}
                    handleChange={handleChange}
                    roles={roles}
                    tenants={tenants}
                    isPlatformAdmin={isPlatformAdmin}
                    isEditing={true}
                    inviteUser={inviteUser}
                    setInviteUser={setInviteUser}
                  />
                </TabsContent>

                <TabsContent value="profile" className="mt-0 space-y-6">
                  {fetching ? <LoadingIndicator /> : (
                    <ProfileForm
                      profileData={profileData}
                      handleProfileChange={handleProfileChange}
                    />
                  )}
                </TabsContent>

                {canManageAdminFields && (
                  <TabsContent value="admin" className="mt-0 space-y-6">
                    {fetching ? <LoadingIndicator /> : (
                      <AdminForm
                        adminData={adminData}
                        handleAdminChange={handleAdminChange}
                      />
                    )}
                  </TabsContent>
                )}
              </div>
            </Tabs>
          )}
        </div>

        <div className="p-5 border-t border-slate-200/70 bg-slate-50/50 dark:border-slate-800/70 dark:bg-slate-900/30 flex justify-end gap-3 shrink-0 z-20">
          <Button type="button" variant="ghost" onClick={handleClose} disabled={loading} className="dark:text-slate-300">
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading} className="bg-indigo-600 hover:bg-indigo-700 min-w-[120px]">
            {loading ? 'Saving...' : <><Save className="w-4 h-4 mr-2" /> Save Changes</>}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// Sub-components for cleaner render
function AccountForm({ formData, handleChange, roles, tenants, isPlatformAdmin, isEditing, inviteUser, setInviteUser }) {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="full_name" className="flex items-center gap-2">
          <User className="w-4 h-4 text-slate-400" /> Full Name
        </Label>
        <Input
          id="full_name"
          name="full_name"
          value={formData.full_name}
          onChange={handleChange}
          placeholder="e.g. John Doe"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="email" className="flex items-center gap-2">
          <Mail className="w-4 h-4 text-slate-400" /> Email Address
        </Label>
        <Input
          id="email"
          name="email"
          type="email"
          value={formData.email}
          onChange={handleChange}
          placeholder="john@example.com"
          disabled={isEditing}
          className={isEditing ? 'bg-slate-100 dark:bg-slate-900 cursor-not-allowed' : ''}
        />
      </div>

      {!isEditing && (
        <div className="space-y-4">
          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="inviteUser"
              checked={inviteUser}
              onChange={(e) => setInviteUser(e.target.checked)}
              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
            />
            <Label htmlFor="inviteUser" className="cursor-pointer">Send email invitation</Label>
          </div>
          {!inviteUser && (
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                value={formData.password}
                onChange={handleChange}
                placeholder="••••••••"
              />
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="role_id">Assign Role</Label>
          <select
            id="role_id"
            name="role_id"
            value={formData.role_id}
            onChange={handleChange}
            className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-950 dark:border-slate-800"
          >
            <option value="" disabled>Select role...</option>
            {roles.filter(r => !r.is_public && !r.is_guest && (isPlatformAdmin || !(r.scope === 'platform' || r.is_platform_admin))).map(role => (
              <option key={role.id} value={role.id}>{role.name}</option>
            ))}
          </select>
        </div>

        {/* Tenant Selector Logic */}
        {(() => {
          const selectedRole = roles.find(r => r.id === formData.role_id);
          const isGlobalRole = Boolean(selectedRole && (selectedRole.scope === 'platform' || selectedRole.is_platform_admin || selectedRole.is_full_access));
          if (isGlobalRole) return null;

          return (
            <div className="space-y-2">
              <Label htmlFor="tenant_id">Assign Tenant</Label>
              <select
                id="tenant_id"
                name="tenant_id"
                value={formData.tenant_id}
                onChange={handleChange}
                className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-950 dark:border-slate-800"
              >
                <option value="" disabled>Select tenant...</option>
                {tenants.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function ProfileForm({ profileData, handleProfileChange }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="job_title">Job Title</Label>
          <div className="relative">
            <Briefcase className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
            <Input id="job_title" name="job_title" value={profileData.job_title} onChange={handleProfileChange} className="pl-9" placeholder="e.g. Manager" />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="department">Department</Label>
          <div className="relative">
            <Building className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
            <Input id="department" name="department" value={profileData.department} onChange={handleProfileChange} className="pl-9" placeholder="e.g. Sales" />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone">Phone</Label>
          <div className="relative">
            <Phone className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
            <Input id="phone" name="phone" value={profileData.phone} onChange={handleProfileChange} className="pl-9" placeholder="+1..." />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="location">Location</Label>
          <div className="relative">
            <MapPin className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
            <Input id="location" name="location" value={profileData.location} onChange={handleProfileChange} className="pl-9" placeholder="City, Country" />
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Bio / Description</Label>
        <Textarea
          id="description"
          name="description"
          value={profileData.description}
          onChange={handleProfileChange}
          placeholder="Short bio..."
          className="min-h-[100px] bg-white dark:bg-slate-950"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="linkedin_url">LinkedIn URL</Label>
          <div className="relative">
            <Globe className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
            <Input id="linkedin_url" name="linkedin_url" value={profileData.linkedin_url} onChange={handleProfileChange} className="pl-9" placeholder="https://linkedin.com/in/..." />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="github_url">GitHub URL</Label>
          <div className="relative">
            {/* Use Globe generic or specific icon if available */}
            <Globe className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
            <Input id="github_url" name="github_url" value={profileData.github_url} onChange={handleProfileChange} className="pl-9" placeholder="https://github.com/..." />
          </div>
        </div>
      </div>
    </div>
  );
}

function AdminForm({ adminData, handleAdminChange }) {
  return (
    <div className="space-y-5 p-4 bg-rose-50/50 dark:bg-rose-950/10 border border-rose-100 dark:border-rose-900/30 rounded-xl">
      <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400 mb-2">
        <Shield className="w-5 h-5" />
        <h4 className="font-semibold">Restricted Admin Area</h4>
      </div>

      <div className="space-y-2">
        <Label htmlFor="admin_notes">Admin Notes (Encrypted)</Label>
        <Textarea
          id="admin_notes"
          name="admin_notes"
          value={adminData.admin_notes}
          onChange={handleAdminChange}
          placeholder="Private notes about this user..."
          className="min-h-[120px] bg-white dark:bg-slate-950 border-rose-200 dark:border-rose-900 focus:border-rose-500 focus:ring-rose-200"
        />
        <p className="text-xs text-slate-500">Only visible to administrators with specific permissions.</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="admin_flags">Admin Flags</Label>
        <div className="relative">
          <Flag className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
          <Input
            id="admin_flags"
            name="admin_flags"
            value={adminData.admin_flags}
            onChange={handleAdminChange}
            className="pl-9 bg-white dark:bg-slate-950 border-rose-200 dark:border-rose-900 focus:border-rose-500 focus:ring-rose-200"
            placeholder="vip, sensitive, audit_required"
          />
        </div>
        <p className="text-xs text-slate-500">Comma-separated flags for system processing.</p>
      </div>
    </div>
  );
}

function LoadingIndicator() {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-slate-500">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mb-2"></div>
      <p className="text-sm">Loading user details...</p>
    </div>
  );
}

export default UserEditor;
