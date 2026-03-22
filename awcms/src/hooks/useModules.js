/**
 * useModules
 *
 * Provides per-tenant module data with enable/disable toggle and sync.
 *
 * API:
 *   modules          – array of module records from DB
 *   loading          – boolean
 *   error            – string | null
 *   fetchModules()   – manual refresh
 *   toggleModuleStatus(moduleId, currentStatus) – flip active ↔ inactive
 *   syncModules()    – call sync_modules_from_sidebar RPC (platform admin only)
 *   isModuleEnabled(slug) – boolean; true when status === 'active'
 */
import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { useTenant } from '@/contexts/TenantContext';
import { usePermissions } from '@/contexts/PermissionContext';
import { dispatchModulesChanged, subscribeToModulesChanged } from '@/lib/moduleEvents';

export function useModules() {
  const { toast } = useToast();
  const { currentTenant } = useTenant();
  const tenantId = currentTenant?.id;
  const { isPlatformAdmin, isFullAccess, hasPermission } = usePermissions();

  const canManage = isPlatformAdmin || isFullAccess || hasPermission('platform.module.manage');
  const canRead   = canManage || hasPermission('platform.module.read');

  const [modules, setModules]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [syncing, setSyncing]   = useState(false);
  const [toggling, setToggling] = useState(null); // moduleId being toggled

  // ─── Fetch ────────────────────────────────────────────────────────────────
  const fetchModules = useCallback(async () => {
    if (!canRead) {
      setModules([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from('modules')
        .select(`
          *,
          tenant:tenants(name)
        `)
        .order('name', { ascending: true });

      // Non-platform admins are scoped to their own tenant.
      // Platform admins omit the filter to see all tenants (RLS allows it).
      if (tenantId && !isPlatformAdmin && !isFullAccess) {
        query = query.eq('tenant_id', tenantId);
      }

      const { data, error: fetchError } = await query;
      if (fetchError) throw fetchError;

      setModules(data || []);
    } catch (err) {
      console.error('[useModules] fetchModules error:', err);
      setError(err.message || 'Failed to load modules');
    } finally {
      setLoading(false);
    }
  }, [tenantId, isPlatformAdmin, isFullAccess, canRead]);

  // ─── Sync from sidebar (platform admin only) ──────────────────────────────
  const syncModules = useCallback(async () => {
    if (!canManage) {
      toast({ variant: 'destructive', title: 'Permission denied', description: 'You cannot sync modules.' });
      return;
    }

    setSyncing(true);
    try {
      const targetTenantIds = [];

      if (isPlatformAdmin || isFullAccess) {
        const { data: tenants, error: tenantsError } = await supabase
          .from('tenants')
          .select('id')
          .is('deleted_at', null)
          .order('created_at', { ascending: true });

        if (tenantsError) throw tenantsError;

        targetTenantIds.push(...(tenants || []).map((tenant) => tenant.id).filter(Boolean));
      } else if (tenantId) {
        targetTenantIds.push(tenantId);
      }

      if (targetTenantIds.length === 0) {
        throw new Error('No tenant targets available for module sync.');
      }

      for (const targetTenantId of targetTenantIds) {
        const { error: syncError } = await supabase.rpc('sync_modules_from_sidebar', {
          p_tenant_id: targetTenantId,
        });

        if (syncError) throw syncError;
        dispatchModulesChanged({ tenantId: targetTenantId, source: 'sync' });
      }

      toast({
        title: 'Synced',
        description: targetTenantIds.length > 1
          ? `Modules synced for ${targetTenantIds.length} tenants.`
          : 'Modules synced from sidebar successfully.',
      });

      await fetchModules();
    } catch (err) {
      console.error('[useModules] syncModules error:', err);
      toast({ variant: 'destructive', title: 'Sync failed', description: err.message || 'Unknown error.' });
    }
    setSyncing(false);
  }, [canManage, tenantId, fetchModules, toast, isPlatformAdmin, isFullAccess]);

  // ─── Toggle active / inactive ─────────────────────────────────────────────
  const toggleModuleStatus = useCallback(async (moduleId, currentStatus, moduleTenantId = tenantId, moduleSlug = null) => {
    if (!canManage) {
      toast({ variant: 'destructive', title: 'Permission denied', description: 'You cannot change module status.' });
      return;
    }

    const nextStatus = currentStatus === 'active' ? 'inactive' : 'active';
    setToggling(moduleId);

    try {
      const { error: updateError } = await supabase
        .from('modules')
        .update({
          status: nextStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', moduleId);

      if (updateError) throw updateError;

      // Optimistic update in local state
      setModules((prev) =>
        prev.map((m) => (m.id === moduleId ? { ...m, status: nextStatus } : m))
      );

      dispatchModulesChanged({
        tenantId: moduleTenantId,
        moduleId,
        slug: moduleSlug || modules.find((m) => m.id === moduleId)?.slug,
        status: nextStatus,
        source: 'toggle',
      });

      toast({
        title: nextStatus === 'active' ? 'Module enabled' : 'Module disabled',
        description: `Module is now ${nextStatus}.`,
      });
    } catch (err) {
      console.error('[useModules] toggleModuleStatus error:', err);
      toast({ variant: 'destructive', title: 'Update failed', description: err.message || 'Unknown error.' });
    } finally {
      setToggling(null);
    }
  }, [canManage, toast, tenantId, modules]);

  // ─── Helper ───────────────────────────────────────────────────────────────
  /**
   * Returns true when the module with the given slug is active (or not found
   * in the DB — fail-open so new/unregistered items are not hidden).
   */
  const isModuleEnabled = useCallback((slug) => {
    if (!slug) return true;
    const found = modules.find((m) => m.slug === slug);
    if (!found) return true; // not in DB → allow through
    return found.status === 'active';
  }, [modules]);

  // ─── Auto-fetch on mount / tenant change ──────────────────────────────────
  useEffect(() => {
    fetchModules();
  }, [fetchModules]);

  useEffect(() => {
    if (!tenantId && !isPlatformAdmin && !isFullAccess) return undefined;

    const channel = supabase
      .channel(isPlatformAdmin || isFullAccess ? 'public:modules:all' : `public:modules:${tenantId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'modules',
          ...(isPlatformAdmin || isFullAccess ? {} : { filter: `tenant_id=eq.${tenantId}` }),
        },
        () => {
          fetchModules();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenantId, fetchModules, isPlatformAdmin, isFullAccess]);

  useEffect(() => {
    return subscribeToModulesChanged(({ tenantId: changedTenantId }) => {
      if (!tenantId || !changedTenantId || changedTenantId === tenantId) {
        fetchModules();
      }
    });
  }, [tenantId, fetchModules]);

  return {
    modules,
    loading,
    error,
    syncing,
    toggling,
    canManage,
    canRead,
    fetchModules,
    syncModules,
    toggleModuleStatus,
    isModuleEnabled,
  };
}
