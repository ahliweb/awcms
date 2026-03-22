/**
 * useNotificationDispatches
 *
 * Read-only access to the `notification_dispatches` table for the current tenant.
 * Supports pagination, filtering by channel type and status, and search.
 *
 * API:
 *   dispatches            – array of dispatch log records
 *   totalCount            – total matching rows
 *   loading               – boolean
 *   error                 – string | null
 *   fetchDispatches(opts) – manual fetch with optional filters/pagination
 *   page                  – current page number
 *   setPage               – setter for page
 *   filters               – active filters object
 *   setFilters            – setter for filters
 */
import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { useTenant } from '@/contexts/TenantContext';
import { usePermissions } from '@/contexts/PermissionContext';

const PAGE_SIZE = 50;

export function useNotificationDispatches() {
  const { toast } = useToast();
  const { currentTenant } = useTenant();
  const tenantId = currentTenant?.id;
  const { isPlatformAdmin, isFullAccess, hasPermission } = usePermissions();

  const canRead = isPlatformAdmin || isFullAccess || hasPermission('tenant.notifications.read') || hasPermission('tenant.notifications.manage');

  const [dispatches, setDispatches]   = useState([]);
  const [totalCount, setTotalCount]   = useState(0);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [page, setPage]               = useState(1);
  const [filters, setFilters]         = useState({
    channel_type: '',
    status: '',
    search: '',
  });

  // ─── Fetch ────────────────────────────────────────────────────────────────
  const fetchDispatches = useCallback(async ({
    pageNum = 1,
    channelType = '',
    status = '',
    search = '',
  } = {}) => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);

    try {
      const from = (pageNum - 1) * PAGE_SIZE;
      const to   = from + PAGE_SIZE - 1;

      let query = supabase
        .from('notification_dispatches')
        .select('*', { count: 'exact' })
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .range(from, to);

      if (channelType) {
        query = query.eq('channel_type', channelType);
      }
      if (status) {
        query = query.eq('status', status);
      }
      if (search) {
        query = query.or(`recipient.ilike.%${search}%,provider_message_id.ilike.%${search}%`);
      }

      const { data, count, error: fetchError } = await query;
      if (fetchError) throw fetchError;

      setDispatches(data || []);
      setTotalCount(count || 0);
    } catch (err) {
      console.error('[useNotificationDispatches] fetchDispatches error:', err);
      setError(err.message || 'Failed to load dispatch log');
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to load notification dispatch log.' });
    } finally {
      setLoading(false);
    }
  }, [tenantId, toast]);

  // ─── Re-fetch whenever page or filters change ────────────────────────────
  useEffect(() => {
    fetchDispatches({
      pageNum: page,
      channelType: filters.channel_type,
      status: filters.status,
      search: filters.search,
    });
  }, [fetchDispatches, page, filters]);

  // ─── Helpers ─────────────────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const refresh = useCallback(() => {
    fetchDispatches({
      pageNum: page,
      channelType: filters.channel_type,
      status: filters.status,
      search: filters.search,
    });
  }, [fetchDispatches, page, filters]);

  return {
    dispatches,
    totalCount,
    totalPages,
    loading,
    error,
    page,
    setPage,
    filters,
    setFilters,
    canRead,
    fetchDispatches,
    refresh,
    PAGE_SIZE,
  };
}
