
import React from 'react';
import { RefreshCw, ArrowRight, LayoutGrid, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useDashboardData } from '@/hooks/useDashboardData';
import { usePermissions } from '@/contexts/PermissionContext';
import { StatCards } from './widgets/StatCards';
import { ActivityFeed } from './widgets/ActivityFeed';
import { ContentDistribution } from './widgets/ContentDistribution';
import { SystemHealth } from './widgets/SystemHealth';
import { Link } from 'react-router-dom';
import { PluginAction } from '@/contexts/PluginContext';
import { PlatformOverview } from './widgets/PlatformOverview';
import { MyApprovals } from './widgets/MyApprovals';
import { UsageWidget } from './widgets/UsageWidget';
import { AdminPageLayout, PageHeader } from '@/templates/awadmintemplate01';

function AdminDashboard() {
    console.log('AdminDashboard rendering...');
    const perms = usePermissions() || {};
    const { userRole } = perms;
    const { data, loading, error, lastUpdated, refresh } = useDashboardData();
    const isTenantAdmin = userRole === 'admin';
    const spacingClass = isTenantAdmin ? 'space-y-10' : 'space-y-8';

    const getGreeting = () => {
        const hour = new Date().getHours();
        if (hour < 5) return 'Good Night';
        if (hour < 12) return 'Good Morning';
        if (hour < 18) return 'Good Afternoon';
        return 'Good Evening';
    };

    const headerActions = [
        {
            label: 'Refresh Data',
            icon: RefreshCw,
            onClick: refresh,
            variant: 'outline',
            className: loading ? 'opacity-70' : 'bg-white/50 backdrop-blur-sm border-slate-200 hover:bg-white hover:border-indigo-300 transition-all'
        }
    ];

    if (error) {
        return (
            <AdminPageLayout>
                <div className="p-8 text-center bg-red-50/50 backdrop-blur-md text-red-600 rounded-2xl border border-red-100 shadow-sm max-w-2xl mx-auto mt-20">
                    <p className="text-lg font-semibold mb-2">Something went wrong</p>
                    <p className="opacity-80 mb-6">{error}</p>
                    <Button onClick={refresh} variant="outline" className="border-red-200 hover:bg-red-50 text-red-600">
                        Try Again
                    </Button>
                </div>
            </AdminPageLayout>
        );
    }

    return (
        <AdminPageLayout className={spacingClass}>
            <PageHeader
                title={`${getGreeting()}, ${userRole?.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()) || 'User'}`}
                description={`Here's your performance overview for ${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}.`}
                icon={LayoutGrid}
                actions={headerActions}
                children={
                    <div className="flex items-center gap-2 text-sm text-slate-500 bg-white/40 px-3 py-1.5 rounded-full border border-white/40 w-fit backdrop-blur-sm">
                        <Calendar className="w-3 h-3" />
                        <span>Last updated: {lastUpdated.toLocaleTimeString()}</span>
                    </div>
                }
            />

            {/* Platform Overview for Global Roles (Owner & Super Admin) */}
            {(userRole === 'owner' || userRole === 'super_admin') && (
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100">
                    <PlatformOverview />
                </div>
            )}

            {/* Main Stats Grid */}
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-200">
                <StatCards
                    data={data.overview}
                    loading={loading}
                    className={isTenantAdmin ? 'gap-8 xl:gap-10' : ''}
                />
            </div>

            {/* Plugin Hook: Dashboard Top */}
            <div className="w-full">
                <PluginAction name="dashboard_top" args={[userRole]} />
            </div>

            {/* Content & Activity Grid */}
            <div className={`grid grid-cols-1 xl:grid-cols-3 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-300 ${isTenantAdmin ? 'gap-10' : 'gap-8'}`}>
                {/* Left Column (2/3 width on XL) */}
                <div className={`xl:col-span-2 ${isTenantAdmin ? 'space-y-10' : 'space-y-8'}`}>
                    <div className={`grid grid-cols-1 md:grid-cols-2 ${isTenantAdmin ? 'gap-10' : 'gap-8'}`}>
                        <ContentDistribution data={data.overview} />
                        <SystemHealth health={data.systemHealth} />
                    </div>

                    {/* Quick Links / Top Content - Neo-Glass style */}
                    <div className="bg-white/60 backdrop-blur-xl rounded-2xl border border-white/40 shadow-sm p-6 sm:p-8 hover:shadow-lg transition-shadow duration-300">
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                                <span className="w-1 h-6 bg-gradient-to-b from-blue-500 to-indigo-600 rounded-full"></span>
                                Top Performing Articles
                            </h3>
                            <Link to="/cmspanel/articles" className="text-sm text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1 group px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition-colors">
                                View All <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                            </Link>
                        </div>
                        <div className="space-y-3">
                            {loading ? (
                                [...Array(3)].map((_, i) => (
                                    <div key={i} className="flex items-center justify-between p-4 bg-white/50 rounded-xl border border-white/50">
                                        <div className="space-y-3 w-full">
                                            <Skeleton className="h-4 w-3/4 bg-slate-200/60" />
                                            <Skeleton className="h-3 w-1/3 bg-slate-200/60" />
                                        </div>
                                    </div>
                                ))
                            ) : data.topContent.length > 0 ? (
                                data.topContent.map((article, i) => (
                                    <div key={i} className="group flex items-center justify-between p-4 bg-white/40 rounded-xl border border-white/20 hover:bg-white/80 hover:border-indigo-100 transition-all duration-200">
                                        <div className="flex flex-col gap-1">
                                            <span className="font-semibold text-slate-800 truncate max-w-[180px] sm:max-w-md group-hover:text-indigo-700 transition-colors">
                                                {article.title}
                                            </span>
                                            <span className="text-xs text-slate-500">Published in {article.category || 'General'}</span>
                                        </div>
                                        <div className="flex items-center gap-4 text-sm">
                                            <span className="text-slate-500 font-medium bg-slate-100/50 px-2 py-1 rounded-md">{article.views || 0} views</span>
                                            <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide border ${article.status === 'published'
                                                ? 'bg-emerald-100/50 text-emerald-700 border-emerald-200'
                                                : 'bg-amber-100/50 text-amber-700 border-amber-200'
                                                }`}>
                                                {article.status}
                                            </span>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="text-center py-10 bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
                                    <p className="text-slate-400">No articles found.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Right Column (1/3 width on XL) - Activity Feed */}
                <div className={isTenantAdmin ? 'space-y-10' : 'space-y-8'}>
                    <UsageWidget />
                    <MyApprovals />
                    <ActivityFeed activities={data.activity} />
                </div>
            </div>
        </AdminPageLayout>
    );
}

export default AdminDashboard;
