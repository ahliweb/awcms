import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { udm } from '@/lib/data/UnifiedDataManager';

const PermissionContext = createContext(undefined);

export const PermissionProvider = ({ children }) => {
  const { user } = useAuth();
  const [permissions, setPermissions] = useState([]);
  const [userRole, setUserRole] = useState(null);
  const [tenantId, setTenantId] = useState(null);
  const [abacPolicies, setAbacPolicies] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchUserPermissions = useCallback(async () => {
    if (!user) {
      setPermissions([]);
      setUserRole(null);
      setTenantId(null);
      setAbacPolicies([]);
      setLoading(false);
      return;
    }

    try {
      // 1. Fetch User Data
      // Attempt to load with deep joins (Online optimal)
      // UDM will strip these joins if Offline/Local, returning just the user row.
      const { data: userDataRaw, error: userError } = await udm.from('users')
        .select(`
          *,
          roles!users_role_id_fkey (
            name,
            role_permissions (
              deleted_at,
              permissions (
                name,
                deleted_at
              )
            ),
            role_policies (
              deleted_at,
              policies (
                definition,
                deleted_at
              )
            )
          )
        `)
        .eq('id', user.id)
        .single(); // Use single()

      if (userError) {
        console.error('Error fetching user permissions:', userError);
      }

      let userData = userDataRaw;

      // 2. Offline Fallback: Reconstruct Data Waterfall if needed
      // If we got user data but missing nested 'roles', and we have a role_id
      if (userData && !userData.roles && userData.role_id) {
        // Fetch Role
        const { data: roleData } = await udm
          .from('roles')
          .select('*')
          .eq('id', userData.role_id)
          .is('deleted_at', null)
          .single();

        if (roleData) {
          userData.roles = roleData;

          // Fetch Role Permissions
          // 1. Get role_permissions map (join table)
          const { data: rpMap } = await udm
            .from('role_permissions')
            .select('*')
            .eq('role_id', roleData.id)
            .is('deleted_at', null);

          if (rpMap && rpMap.length > 0) {
            const permIds = rpMap.map(rp => rp.permission_id);
            // 2. Get actual permissions
            const { data: perms } = await udm
              .from('permissions')
              .select('name')
              .in('id', permIds)
              .is('deleted_at', null);
            if (perms) {
              userData.roles.role_permissions = perms.map(p => ({ permissions: p }));
            }
          }

          // Fetch Role Policies
          // 1. Get role_policies map
          const { data: rPolMap } = await udm
            .from('role_policies')
            .select('*')
            .eq('role_id', roleData.id)
            .is('deleted_at', null);

          if (rPolMap && rPolMap.length > 0) {
            const policyIds = rPolMap.map(rp => rp.policy_id);
            // 2. Get actual policies
            const { data: pols } = await udm
              .from('policies')
              .select('definition')
              .in('id', policyIds)
              .is('deleted_at', null);
            if (pols) {
              userData.roles.role_policies = pols.map(p => ({ policies: p }));
            }
          }
        }
      }

      let dbRole = null;
      let dbPermissions = [];
      let dbTenantId = null;

      if (userData) {
        dbTenantId = userData.tenant_id;
        if (userData.roles) {
          dbRole = userData.roles.name;

          if (dbRole === 'super_admin' || dbRole === 'owner') {
            // Will fetch all perms later
          } else {
            dbPermissions = userData.roles.role_permissions
              ?.filter(rp => !rp.deleted_at && rp.permissions && !rp.permissions.deleted_at)
              .map(rp => rp.permissions?.name)
              .filter(Boolean) || [];

            const policies = userData.roles.role_policies
              ?.filter(rp => !rp.deleted_at && rp.policies && !rp.policies.deleted_at)
              .map(rp => rp.policies?.definition)
              .filter(Boolean) || [];
            setAbacPolicies(policies);
          }
        }
      }

      setTenantId(dbTenantId);

      // 3. Determine Final Role
      const superAdminEmail = import.meta.env.VITE_SUPER_ADMIN_EMAIL;
      let finalRole = dbRole || 'guest';
      let finalPermissions = dbPermissions;

      if (superAdminEmail && user.email === superAdminEmail) {
        if (finalRole !== 'owner') {
          finalRole = 'super_admin';
        }
      }

      setUserRole(finalRole);

      // 4. Load Permissions for Admin Roles
      if (finalRole === 'super_admin' || finalRole === 'owner') {
        // Attempt to fetch all permissions from UDM
        const { data: allPerms } = await udm.from('permissions').select('name').is('deleted_at', null);
        if (allPerms) {
          finalPermissions = allPerms.map(p => p.name);
        } else {
          // Fallback if UDM fails or is empty, maybe implied * access
          // but normally table should exist locally or remotely
          finalPermissions = ['*']; // Or handle as "All Access" logic in checks
        }
      }

      setPermissions(finalPermissions || []);

    } catch (error) {
      console.error('Unexpected error fetching permissions:', error);
      // Fallback to empty context to prevent crash loops
      setPermissions([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchUserPermissions();
  }, [fetchUserPermissions]);

  const hasPermission = useCallback((permission) => {
    if (!permission) return true;
    if (['super_admin', 'owner'].includes(userRole)) return true;

    // Safety Net
    const superAdminEmail = import.meta.env.VITE_SUPER_ADMIN_EMAIL;
    if (superAdminEmail && user?.email === superAdminEmail) return true;

    return permissions.includes(permission);
  }, [permissions, userRole, user]);

  const hasAnyPermission = useCallback((permissionList) => {
    if (['super_admin', 'owner'].includes(userRole)) return true;
    const superAdminEmail = import.meta.env.VITE_SUPER_ADMIN_EMAIL;
    if (superAdminEmail && user?.email === superAdminEmail) return true;

    if (!permissionList || permissionList.length === 0) return true;
    return permissionList.some(p => permissions.includes(p));
  }, [permissions, userRole, user]);

  const checkAccess = useCallback((action, resource, record = null) => {
    if (['super_admin', 'owner'].includes(userRole)) return true;

    const hasScope = resource.includes('.');
    const permissionKey = hasScope ? `${resource}.${action}` : `tenant.${resource}.${action}`;

    if (permissions.includes(permissionKey)) return true;

    if (record && record.created_by && user) {
      if (record.created_by === user.id) return true;
    }

    return false;
  }, [permissions, userRole, user]);

  const checkPolicy = useCallback((action, resource, context = {}) => {
    if (['super_admin', 'owner'].includes(userRole)) return true;

    const finalContext = { channel: 'web', ...context };

    // Check deny policies
    const denyMatch = abacPolicies.some(policy => {
      if (policy.effect !== 'deny') return false;
      if (!policy.actions.includes('*') && !policy.actions.includes(action)) return false;
      if (policy.conditions) {
        if (policy.conditions.channel && policy.conditions.channel !== finalContext.channel) return false;
      }
      return true;
    });

    if (denyMatch) return false;
    return true;
  }, [abacPolicies, userRole]);

  const isPlatformAdmin = useMemo(() => {
    return ['owner', 'super_admin'].includes(userRole);
  }, [userRole]);

  const value = React.useMemo(() => ({
    permissions,
    userRole,
    tenantId,
    isPlatformAdmin,
    loading,
    hasPermission,
    hasAnyPermission,
    checkAccess,
    checkPolicy,
    refreshPermissions: fetchUserPermissions
  }), [permissions, userRole, tenantId, isPlatformAdmin, loading, hasPermission, hasAnyPermission, checkAccess, checkPolicy, fetchUserPermissions]);

  return (
    <PermissionContext.Provider value={value}>
      {children}
    </PermissionContext.Provider>
  );
};

export const usePermissions = () => {
  const context = useContext(PermissionContext);
  if (context === undefined) {
    throw new Error('usePermissions must be used within a PermissionProvider');
  }
  return context;
};
