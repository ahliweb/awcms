import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { usePermissions } from '@/contexts/PermissionContext';

export function usePlatformStats() {
    const { session } = useAuth();
    const { isPlatformAdmin, isFullAccess, hasPermission } = usePermissions();
    const [stats, setStats] = useState({
        totalTenants: 0,
        totalUsers: 0,
        totalStorage: 0,
        tenantsByTier: { free: 0, pro: 0, enterprise: 0 },
        recentTenants: []
    });
    const [loading, setLoading] = useState(true);

    const fetchStats = useCallback(async () => {
        const canReport = isPlatformAdmin || isFullAccess || hasPermission('platform.reporting.read');
        if (!session || !canReport) {
            setLoading(false);
            return;
        }
        try {
            setLoading(true);

            // 1. Fetch Tenants
            const { data: tenants, error: tenantsError } = await supabase
                .from('tenants')
                .select('id, name, subscription_tier, created_at')
                .order('created_at', { ascending: false });

            if (tenantsError) throw tenantsError;

            // 2. Fetch All Users (As Platform Admin, RLS allows this - verified via policy)
            const { count: userCount, error: userError } = await supabase
                .from('users')
                .select('*', { count: 'exact', head: true });

            if (userError) throw userError;

            // 3. Fetch Total File Storage
            const { data: files, error: fileError } = await supabase
                .from('files')
                .select('file_size')
                .is('deleted_at', null);

            if (fileError) throw fileError;

            // Process Data
            const totalStorage = files?.reduce((acc, curr) => acc + (curr.file_size || 0), 0) || 0;

            const tiers = { free: 0, pro: 0, enterprise: 0 };
            tenants?.forEach(t => {
                const tier = t.subscription_tier || 'free';
                if (tiers[tier] !== undefined) tiers[tier]++;
            });

            setStats({
                totalTenants: tenants?.length || 0,
                totalUsers: userCount || 0,
                totalStorage,
                tenantsByTier: tiers,
                recentTenants: tenants?.slice(0, 5) || []
            });

        } catch (error) {
            console.error("Error fetching platform stats:", error);
        } finally {
            setLoading(false);
        }
    }, [session, isPlatformAdmin, isFullAccess, hasPermission]);

    useEffect(() => {
        fetchStats();
    }, [fetchStats]);

    return { stats, loading, refresh: fetchStats };
}
