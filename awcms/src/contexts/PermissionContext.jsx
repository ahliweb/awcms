import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { udm } from '@/lib/data/UnifiedDataManager';

const PermissionContext = createContext(undefined);

export const PermissionProvider = ({ children }) => {
  const { user } = useAuth();
  const [permissions, setPermissions] = useState([]);
  const [userRole, setUserRole] = useState(null);
  const [role, setRole] = useState(null);
  const [tenantId, setTenantId] = useState(null);
  const [abacPolicies, setAbacPolicies] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchUserPermissions = useCallback(async () => {
      if (!user) {
        setPermissions([]);
        setUserRole(null);
        setRole(null);
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
            scope,
            is_platform_admin,
            is_full_access,
            is_tenant_admin,
            is_public,
            is_guest,
            is_staff,
            staff_level,
            is_system,
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
      let roleData = null;
      let roleFlags = {
        isPlatformAdmin: false,
        isFullAccess: false,
        isTenantAdmin: false,
        isPublicRole: false,
        isGuestRole: false,
        isStaff: false,
        staffLevel: null,
        scope: null
      };

      if (userData) {
        dbTenantId = userData.tenant_id;
        if (userData.roles) {
          roleData = userData.roles;
          dbRole = roleData.name;
          roleFlags = {
            isPlatformAdmin: Boolean(roleData.is_platform_admin),
            isFullAccess: Boolean(roleData.is_full_access || roleData.is_platform_admin),
            isTenantAdmin: Boolean(roleData.is_tenant_admin),
            isPublicRole: Boolean(roleData.is_public),
            isGuestRole: Boolean(roleData.is_guest),
            isStaff: Boolean(roleData.is_staff),
            staffLevel: roleData.staff_level ?? null,
            scope: roleData.scope || null
          };

          if (!roleFlags.isFullAccess) {
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
      let finalRole = dbRole || 'guest';
      let finalPermissions = dbPermissions;
      setRole(roleData);
      setUserRole(finalRole);

      // 4. Load Permissions for Admin Roles
      if (roleFlags.isFullAccess) {
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
    if (role?.is_full_access || role?.is_platform_admin) return true;
    if (permissions.includes('*')) return true;

    return permissions.includes(permission);
  }, [permissions, role]);

  const hasAnyPermission = useCallback((permissionList) => {
    if (role?.is_full_access || role?.is_platform_admin) return true;
    if (permissions.includes('*')) return true;

    if (!permissionList || permissionList.length === 0) return true;
    return permissionList.some(p => permissions.includes(p));
  }, [permissions, role]);

  /**
   * Check if the current user owns the record
   * @param {object} record - Record with created_by field
   * @returns {boolean}
   */
  const checkOwnership = useCallback((record) => {
    if (!record || !user) return false;
    return record.created_by === user.id || record.owner_id === user.id;
  }, [user]);

  const checkAccess = useCallback((action, resource, record = null) => {
    // Platform admins always have access
    if (role?.is_full_access || role?.is_platform_admin) return true;

    // Determine the permission key based on scope
    const hasScope = resource.includes('.');
    const permissionKey = hasScope ? `${resource}.${action}` : `tenant.${resource}.${action}`;

    // Check if user has the specific permission
    if (permissions.includes(permissionKey)) {
      // For 'update' action, check ownership if role is 'author'
      if (action === 'update' && userRole === 'author' && record) {
        return checkOwnership(record);
      }
      return true;
    }

    // Fallback: if action is 'update' and no explicit permission, allow if user owns the record
    if (action === 'update' && record && user && record.created_by === user.id) {
      return true;
    }

    return false;
  }, [permissions, userRole, user, checkOwnership, role]);

  /**
   * Shorthand: Can user publish content in this resource?
   */
  const canPublish = useCallback((resource) => {
    return checkAccess('publish', resource);
  }, [checkAccess]);

  /**
   * Shorthand: Can user restore soft-deleted items in this resource?
   */
  const canRestore = useCallback((resource) => {
    return checkAccess('restore', resource);
  }, [checkAccess]);

  /**
   * Shorthand: Can user permanently delete items in this resource?
   */
  const canPermanentDelete = useCallback((resource) => {
    return checkAccess('delete_permanent', resource);
  }, [checkAccess]);

  /**
   * Shorthand: Can user soft-delete items in this resource?
   */
  const canSoftDelete = useCallback((resource) => {
    return checkAccess('soft_delete', resource);
  }, [checkAccess]);

  const checkPolicy = useCallback((action, resource, context = {}) => {
    if (role?.is_full_access || role?.is_platform_admin) return true;

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
  }, [abacPolicies, role]);

  const isPlatformAdmin = useMemo(() => {
    return Boolean(role?.is_platform_admin || role?.is_full_access);
  }, [role]);

  const isFullAccess = useMemo(() => {
    return Boolean(role?.is_full_access || role?.is_platform_admin);
  }, [role]);

  const isTenantAdmin = useMemo(() => {
    return Boolean(role?.is_tenant_admin);
  }, [role]);

  const isPublicRole = useMemo(() => {
    return Boolean(role?.is_public);
  }, [role]);

  const isGuestRole = useMemo(() => {
    return Boolean(role?.is_guest);
  }, [role]);

  const isStaff = useMemo(() => {
    return Boolean(role?.is_staff);
  }, [role]);

  const staffLevel = useMemo(() => {
    return role?.staff_level ?? null;
  }, [role]);

  const value = React.useMemo(() => ({
    permissions,
    userRole,
    role,
    tenantId,
    isPlatformAdmin,
    isFullAccess,
    isTenantAdmin,
    isPublicRole,
    isGuestRole,
    isStaff,
    staffLevel,
    loading,
    hasPermission,
    hasAnyPermission,
    checkAccess,
    checkOwnership,
    checkPolicy,
    canPublish,
    canRestore,
    canPermanentDelete,
    canSoftDelete,
    refreshPermissions: fetchUserPermissions
  }), [permissions, userRole, role, tenantId, isPlatformAdmin, isFullAccess, isTenantAdmin, isPublicRole, isGuestRole, isStaff, staffLevel, loading, hasPermission, hasAnyPermission, checkAccess, checkOwnership, checkPolicy, canPublish, canRestore, canPermanentDelete, canSoftDelete, fetchUserPermissions]);

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
