import { useEffect, useState } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { usePermissions } from '@/contexts/PermissionContext';
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Database, Users, TrendingUp } from "lucide-react";

// Limits must match SQL enforcement logic
const TIERS = {
    free: { max_users: 5, max_storage: 104857600, label: 'Free Plan' },
    pro: { max_users: 50, max_storage: 10737418240, label: 'Pro Plan' },
    enterprise: { max_users: -1, max_storage: -1, label: 'Enterprise' }
};

export function UsageWidget() {
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

    const formatBytes = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    if (loading) {
        return (
            <Card className="dashboard-surface dashboard-surface-hover">
                <CardContent className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </CardContent>
            </Card>
        );
    }

    if (!tenantId) return null;

    const limits = TIERS[tier] || TIERS.free;
    const storagePercent = limits.max_storage === -1 ? 0 : Math.min((usage.storage / limits.max_storage) * 100, 100);
    const usersPercent = limits.max_users === -1 ? 0 : Math.min((usage.users / limits.max_users) * 100, 100);

    return (
        <Card className="dashboard-surface dashboard-surface-hover">
            <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" />
                    Resource Usage
                    <span className="ml-auto text-xs font-normal text-muted-foreground bg-primary/10 px-2 py-0.5 rounded">
                        {limits.label}
                    </span>
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Users Usage */}
                <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                        <span className="flex items-center gap-2 text-muted-foreground">
                            <Users className="h-4 w-4" /> Users
                        </span>
                        <span className="font-medium">
                            {usage.users} / {limits.max_users === -1 ? '∞' : limits.max_users}
                        </span>
                    </div>
                    {limits.max_users !== -1 && (
                        <Progress
                            value={usersPercent}
                            className="h-2"
                        />
                    )}
                </div>

                {/* Storage Usage */}
                <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                        <span className="flex items-center gap-2 text-muted-foreground">
                            <Database className="h-4 w-4" /> Storage
                        </span>
                        <span className="font-medium">
                            {formatBytes(usage.storage)} / {limits.max_storage === -1 ? '∞' : formatBytes(limits.max_storage)}
                        </span>
                    </div>
                    {limits.max_storage !== -1 && (
                        <Progress
                            value={storagePercent}
                            className="h-2"
                        />
                    )}
                </div>

                {tier === 'free' && (
                    <div className="pt-2 border-t dark:border-slate-700">
                        <button className="text-xs text-primary hover:underline">
                            Upgrade to Pro →
                        </button>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
