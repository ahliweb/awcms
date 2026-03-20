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
  const [toggling, setToggling] = useState(null); // moduleId being toggled

  // ─── Fetch ────────────────────────────────────────────────────────────────
  const fetchModules = useCallback(async () => {
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
  }, [tenantId, isPlatformAdmin, isFullAccess]);

  // ─── Sync from sidebar (platform admin only) ──────────────────────────────
  const syncModules = useCallback(async () => {
    if (!canManage) {
      toast({ variant: 'destructive', title: 'Permission denied', description: 'You cannot sync modules.' });
      return;
    }

    setLoading(true);
    try {
      const { error: syncError } = await supabase.rpc('sync_modules_from_sidebar', {
        p_tenant_id: tenantId || null,
      });

      if (syncError) throw syncError;

      toast({ title: 'Synced', description: 'Modules synced from sidebar successfully.' });
      await fetchModules();
    } catch (err) {
      console.error('[useModules] syncModules error:', err);
      toast({ variant: 'destructive', title: 'Sync failed', description: err.message || 'Unknown error.' });
      setLoading(false);
    }
  }, [canManage, tenantId, fetchModules, toast]);

  // ─── Toggle active / inactive ─────────────────────────────────────────────
  const toggleModuleStatus = useCallback(async (moduleId, currentStatus) => {
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
  }, [canManage, toast]);

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

  return {
    modules,
    loading,
    error,
    toggling,
    canManage,
    canRead,
    fetchModules,
    syncModules,
    toggleModuleStatus,
    isModuleEnabled,
  };
}

export default useModules;
