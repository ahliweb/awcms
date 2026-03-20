/**
 * useNotificationChannels
 *
 * Manages per-tenant notification channel configurations (email, whatsapp, telegram).
 * CRUD operations for the `tenant_notification_channels` table.
 *
 * API:
 *   channels              – array of channel records
 *   loading               – boolean
 *   error                 – string | null
 *   fetchChannels()       – manual refresh
 *   saveChannel(payload)  – upsert a channel config (insert or update by type)
 *   deleteChannel(id)     – soft delete a channel config
 *   toggleChannel(id, currentEnabled) – flip enabled flag
 */
import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { useTenant } from '@/contexts/TenantContext';
import { usePermissions } from '@/contexts/PermissionContext';

export function useNotificationChannels() {
  const { toast } = useToast();
  const { currentTenant } = useTenant();
  const tenantId = currentTenant?.id;
  const { isPlatformAdmin, isFullAccess, hasPermission } = usePermissions();

  const canManage = isPlatformAdmin || isFullAccess || hasPermission('tenant.notifications.manage');
  const canRead   = canManage || hasPermission('tenant.notifications.read');

  const [channels, setChannels]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [saving, setSaving]       = useState(false);

  // ─── Fetch ────────────────────────────────────────────────────────────────
  const fetchChannels = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await supabase
        .from('tenant_notification_channels')
        .select('*')
        .eq('tenant_id', tenantId)
        .is('deleted_at', null)
        .order('channel_type', { ascending: true });

      if (fetchError) throw fetchError;
      setChannels(data || []);
    } catch (err) {
      console.error('[useNotificationChannels] fetchChannels error:', err);
      setError(err.message || 'Failed to load notification channels');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  // ─── Save (upsert by tenant + channel_type) ───────────────────────────────
  /**
   * payload: { channel_type, credentials, enabled, quota_per_day, display_name }
   * If a record with the same tenant_id + channel_type exists, it is updated.
   * Otherwise a new record is inserted.
   */
  const saveChannel = useCallback(async (payload) => {
    if (!tenantId) {
      toast({ variant: 'destructive', title: 'Missing tenant context' });
      return false;
    }
    if (!canManage) {
      toast({ variant: 'destructive', title: 'Permission denied', description: 'You cannot manage notification channels.' });
      return false;
    }

    setSaving(true);
    try {
      const record = {
        tenant_id: tenantId,
        channel_type: payload.channel_type,
        credentials: payload.credentials ?? {},
        enabled: payload.enabled ?? false,
        quota_per_day: payload.quota_per_day ?? null,
        display_name: payload.display_name ?? null,
        updated_at: new Date().toISOString(),
        deleted_at: null,
      };

      const { data, error: upsertError } = await supabase
        .from('tenant_notification_channels')
        .upsert(record, { onConflict: 'tenant_id,channel_type' })
        .select()
        .single();

      if (upsertError) throw upsertError;

      // Optimistic update in local state
      setChannels((prev) => {
        const idx = prev.findIndex((c) => c.channel_type === payload.channel_type);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = data;
          return updated;
        }
        return [...prev, data];
      });

      toast({ title: 'Saved', description: `${payload.channel_type} channel configuration saved.` });
      return true;
    } catch (err) {
      console.error('[useNotificationChannels] saveChannel error:', err);
      toast({ variant: 'destructive', title: 'Save failed', description: err.message || 'Unknown error.' });
      return false;
    } finally {
      setSaving(false);
    }
  }, [tenantId, canManage, toast]);

  // ─── Toggle enabled flag ──────────────────────────────────────────────────
  const toggleChannel = useCallback(async (id, currentEnabled) => {
    if (!canManage) {
      toast({ variant: 'destructive', title: 'Permission denied' });
      return;
    }

    const nextEnabled = !currentEnabled;
    try {
      const { error: updateError } = await supabase
        .from('tenant_notification_channels')
        .update({ enabled: nextEnabled, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('tenant_id', tenantId);

      if (updateError) throw updateError;

      setChannels((prev) =>
        prev.map((c) => (c.id === id ? { ...c, enabled: nextEnabled } : c))
      );

      toast({
        title: nextEnabled ? 'Channel enabled' : 'Channel disabled',
        description: `Notification channel is now ${nextEnabled ? 'active' : 'inactive'}.`,
      });
    } catch (err) {
      console.error('[useNotificationChannels] toggleChannel error:', err);
      toast({ variant: 'destructive', title: 'Update failed', description: err.message || 'Unknown error.' });
    }
  }, [tenantId, canManage, toast]);

  // ─── Soft delete ─────────────────────────────────────────────────────────
  const deleteChannel = useCallback(async (id) => {
    if (!canManage) {
      toast({ variant: 'destructive', title: 'Permission denied' });
      return false;
    }

    try {
      const { error: deleteError } = await supabase
        .from('tenant_notification_channels')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id)
        .eq('tenant_id', tenantId);

      if (deleteError) throw deleteError;

      setChannels((prev) => prev.filter((c) => c.id !== id));
      toast({ title: 'Removed', description: 'Notification channel configuration removed.' });
      return true;
    } catch (err) {
      console.error('[useNotificationChannels] deleteChannel error:', err);
      toast({ variant: 'destructive', title: 'Delete failed', description: err.message || 'Unknown error.' });
      return false;
    }
  }, [tenantId, canManage, toast]);

  // ─── Helper: get channel by type ─────────────────────────────────────────
  const getChannelByType = useCallback((type) => {
    return channels.find((c) => c.channel_type === type) || null;
  }, [channels]);

  // ─── Auto-fetch on mount / tenant change ──────────────────────────────────
  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  return {
    channels,
    loading,
    error,
    saving,
    canManage,
    canRead,
    fetchChannels,
    saveChannel,
    toggleChannel,
    deleteChannel,
    getChannelByType,
  };
}

export default useNotificationChannels;
