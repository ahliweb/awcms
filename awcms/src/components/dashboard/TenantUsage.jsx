import { useEffect, useState } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { usePermissions } from '@/contexts/PermissionContext';
import { Progress } from "@/components/ui/progress";
import { Users, Database } from "lucide-react";

// Limits must match SQL enforcement logic
const TIERS = {
    free: { max_users: 5, max_storage: 104857600, label: 'Free Plan' },
    pro: { max_users: 50, max_storage: 10737418240, label: 'Pro Plan' },
    enterprise: { max_users: -1, max_storage: -1, label: 'Enterprise' }
};

export function TenantUsage() {
    const { tenantId } = usePermissions();
    const [usage, setUsage] = useState({ users: 0, storage: 0 });
    const [tier, setTier] = useState('free');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!tenantId) {
            setLoading(false);
            return;
        }

        const fetchData = async () => {
            setLoading(true);
            try {
                // 1. Get Tenant Tier
                const { data: tenant } = await supabase
                    .from('tenants')
                    .select('subscription_tier')
                    .eq('id', tenantId)
                    .single();

                const currentTier = tenant?.subscription_tier || 'free';
                setTier(currentTier);

                // 2. Get User Count (RLS automatically restricts to tenant)
                const { count: userCount } = await supabase
                    .from('users')
                    .select('*', { count: 'exact', head: true });

                // 3. Get Storage Usage (Sum file_size)
                const { data: files } = await supabase
                    .from('files')
                    .select('file_size')
                    .is('deleted_at', null);

                const totalSize = files?.reduce((acc, f) => acc + (f.file_size || 0), 0) || 0;

                setUsage({ users: userCount || 0, storage: totalSize });

            } catch (error) {
                console.error("Error fetching usage:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [tenantId]);

    // Don't show if loading or no tenantId
    if (loading || !tenantId) return null;

    const limits = TIERS[tier] || TIERS.free;
    const storagePercent = limits.max_storage === -1 ? 0 : Math.min((usage.storage / limits.max_storage) * 100, 100);
    const usersPercent = limits.max_users === -1 ? 0 : Math.min((usage.users / limits.max_users) * 100, 100);

    const formatBytes = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    return (
        <div className="px-4 py-2 border-t border-slate-800 bg-slate-900/50">
            <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{limits.label}</span>
                {tier === 'free' && <span className="text-xs text-blue-400 cursor-pointer hover:underline">Upgrade</span>}
            </div>

            <div className="space-y-3">
                {/* Users Usage */}
                <div className="space-y-1">
                    <div className="flex justify-between text-[10px] text-slate-400">
                        <span className="flex items-center gap-1"><Users className="w-3 h-3" /> Users</span>
                        <span>{usage.users} / {limits.max_users === -1 ? '∞' : limits.max_users}</span>
                    </div>
                    {limits.max_users !== -1 && (
                        <Progress value={usersPercent} className="h-1 bg-slate-800" indicatorClassName={usersPercent > 90 ? "bg-red-500" : "bg-blue-500"} />
                    )}
                </div>

                {/* Storage Usage */}
                <div className="space-y-1">
                    <div className="flex justify-between text-[10px] text-slate-400">
                        <span className="flex items-center gap-1"><Database className="w-3 h-3" /> Storage</span>
                        <span>{formatBytes(usage.storage)} / {limits.max_storage === -1 ? '∞' : formatBytes(limits.max_storage)}</span>
                    </div>
                    {limits.max_storage !== -1 && (
                        <Progress value={storagePercent} className="h-1 bg-slate-800" indicatorClassName={storagePercent > 90 ? "bg-red-500" : "bg-purple-500"} />
                    )}
                </div>
            </div>
        </div>
    );
}
