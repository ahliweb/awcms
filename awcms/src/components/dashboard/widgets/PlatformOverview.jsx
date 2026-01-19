import React from 'react';
import { useTranslation } from 'react-i18next';
import { usePlatformStats } from '@/hooks/usePlatformStats';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, Users, Database, ShieldCheck, TrendingUp, Activity } from 'lucide-react';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

export function PlatformOverview() {
    const { t } = useTranslation();
    const { stats, loading } = usePlatformStats();

    if (loading) {
        return <Skeleton className="h-48 w-full rounded-2xl bg-slate-100/50 backdrop-blur-sm mb-8" />;
    }

    const formatBytes = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    return (
        <div className="space-y-8 mb-10 overflow-hidden">
            <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-600">
                    <ShieldCheck className="w-6 h-6" />
                </div>
                <h2 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-slate-700 dark:from-white dark:to-slate-300">
                    {t('dashboard.platform.overview')}
                </h2>
            </div>

            {/* Top Stats - Neo Glass */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <Card className="bg-white/60 dark:bg-slate-800/60 backdrop-blur-xl border-white/40 dark:border-slate-700/40 shadow-sm hover:shadow-md transition-all duration-300">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-400">{t('dashboard.platform.total_tenants')}</CardTitle>
                        <Building2 className="h-4 w-4 text-indigo-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-extrabold text-slate-900 dark:text-white">{stats.totalTenants}</div>
                        <div className="mt-2 text-xs flex gap-2">
                            <Badge variant="outline" className="bg-blue-50/50 text-blue-700 border-blue-200">
                                {stats.tenantsByTier.pro} {t('dashboard.platform.tier_pro')}
                            </Badge>
                            <Badge variant="outline" className="bg-purple-50/50 text-purple-700 border-purple-200">
                                {stats.tenantsByTier.enterprise} {t('dashboard.platform.tier_ent')}
                            </Badge>
                        </div>
                    </CardContent>
                </Card>

                <Card className="bg-white/60 dark:bg-slate-800/60 backdrop-blur-xl border-white/40 dark:border-slate-700/40 shadow-sm hover:shadow-md transition-all duration-300">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-400">{t('dashboard.platform.system_users')}</CardTitle>
                        <Users className="h-4 w-4 text-emerald-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-extrabold text-slate-900 dark:text-white">{stats.totalUsers}</div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-medium">{t('dashboard.platform.active_across_data')}</p>
                    </CardContent>
                </Card>

                <Card className="bg-white/60 dark:bg-slate-800/60 backdrop-blur-xl border-white/40 dark:border-slate-700/40 shadow-sm hover:shadow-md transition-all duration-300">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-400">{t('dashboard.platform.system_storage')}</CardTitle>
                        <Database className="h-4 w-4 text-orange-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-extrabold text-slate-900 dark:text-white">{formatBytes(stats.totalStorage)}</div>
                        {/* Visual Progress Bar */}
                        <div className="w-full bg-slate-200/50 dark:bg-slate-700/50 rounded-full h-1.5 mt-3 overflow-hidden">
                            <div className="bg-gradient-to-r from-orange-400 to-red-500 h-1.5 rounded-full" style={{ width: '45%' }}></div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-indigo-500 to-purple-600 text-white border-0 shadow-lg shadow-indigo-500/25 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full blur-2xl -mr-10 -mt-10 transition-transform duration-700 group-hover:scale-150"></div>

                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 relative z-10">
                        <CardTitle className="text-sm font-medium text-indigo-100">{t('dashboard.platform.health')}</CardTitle>
                        <Activity className="h-4 w-4 text-indigo-200 animate-pulse" />
                    </CardHeader>
                    <CardContent className="relative z-10">
                        <div className="text-3xl font-extrabold text-white">100%</div>
                        <p className="text-xs text-indigo-100 mt-1">{t('dashboard.platform.systems_operational')}</p>
                    </CardContent>
                </Card>
            </div>

            {/* Recent Tenants Table - Glass Pane */}
            <Card className="bg-white/60 dark:bg-slate-800/60 backdrop-blur-xl border-white/40 dark:border-slate-700/40 shadow-sm">
                <CardHeader>
                    <CardTitle className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
                        <TrendingUp className="w-5 h-5 text-slate-400" />
                        {t('dashboard.platform.recent_registrations')}
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        {stats.recentTenants.map(tenant => (
                            <div key={tenant.id} className="group flex items-center justify-between border-b border-slate-100/50 dark:border-slate-700/50 last:border-0 pb-4 last:pb-0 hover:bg-white/50 dark:hover:bg-slate-700/50 p-2 rounded-lg transition-colors">
                                <div className="flex items-center gap-4">
                                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-700 dark:to-slate-600 flex items-center justify-center text-slate-600 dark:text-slate-300 shadow-inner">
                                        <Building2 className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <p className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">{tenant.name}</p>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">{t('dashboard.platform.joined')} {format(new Date(tenant.created_at), 'MMM d, yyyy')}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <Badge variant={tenant.subscription_tier === 'free' ? 'secondary' : 'default'}
                                        className={`uppercase text-[10px] tracking-wider font-bold ${tenant.subscription_tier === 'enterprise' ? 'bg-purple-100 text-purple-700 hover:bg-purple-200' :
                                            tenant.subscription_tier === 'pro' ? 'bg-blue-100 text-blue-700 hover:bg-blue-200' :
                                                'bg-slate-100 text-slate-700 hover:bg-slate-200'
                                            }`}>
                                        {tenant.subscription_tier}
                                    </Badge>
                                </div>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
