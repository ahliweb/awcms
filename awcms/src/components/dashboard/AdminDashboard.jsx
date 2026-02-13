
import { RefreshCw, LayoutGrid, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDashboardData } from '@/hooks/useDashboardData';
import { usePermissions } from '@/contexts/PermissionContext';
import { StatCards } from './widgets/StatCards';
import { ActivityFeed } from './widgets/ActivityFeed';
import { ContentDistribution } from './widgets/ContentDistribution';
import { SystemHealth } from './widgets/SystemHealth';
import { PluginAction } from '@/contexts/PluginContext';
import { PlatformOverview } from './widgets/PlatformOverview';
import { MyApprovals } from './widgets/MyApprovals';
import { UsageWidget } from './widgets/UsageWidget';
import { TopBlogsWidget } from './widgets/TopBlogsWidget';
import PluginWidgets from './widgets/PluginWidgets';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';
import { cn } from '@/lib/utils';

function AdminDashboard() {
    const perms = usePermissions() || {};
    const { isTenantAdmin, isPlatformAdmin, userRole } = perms;
    const { data, loading, error, lastUpdated, refresh } = useDashboardData();
    const spacingClass = isTenantAdmin ? 'space-y-10' : 'space-y-8';
    const layoutClass = cn('w-full', spacingClass);

    const getGreeting = () => {
        const hour = new Date().getHours();
        if (hour < 5) return 'Good Night';
        if (hour < 12) return 'Good Morning';
        if (hour < 18) return 'Good Afternoon';
        return 'Good Evening';
    };

    const headerActions = (
        <Button
            onClick={refresh}
            variant="outline"
            className={loading ? 'opacity-70' : 'bg-white/70 dark:bg-slate-900/60 backdrop-blur-sm border-slate-200/70 dark:border-slate-700/60 hover:bg-white dark:hover:bg-slate-800 hover:border-indigo-300/80 dark:hover:border-indigo-500/60 transition-all shadow-sm'}
        >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh Data
        </Button>
    );

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
        <AdminPageLayout className={layoutClass}>
            <PageHeader
                title={`${getGreeting()}, ${userRole?.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()) || 'User'}`}
                description={`Here's your performance overview for ${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}.`}
                icon={LayoutGrid}
                actions={headerActions}
            >
                <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 bg-white/40 dark:bg-slate-800/40 px-3 py-1.5 rounded-full border border-white/40 dark:border-slate-700/40 w-fit backdrop-blur-sm">
                    <Calendar className="w-3 h-3" />
                    <span>Last updated: {lastUpdated.toLocaleTimeString()}</span>
                </div>
            </PageHeader>

            {/* Platform Overview for platform admins */}
            {isPlatformAdmin && (
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

            <PluginWidgets
                position="main"
                layout="grid"
                className={`animate-in fade-in slide-in-from-bottom-4 duration-700 delay-250 grid-cols-1 md:grid-cols-2 ${isTenantAdmin ? 'gap-10' : 'gap-8'}`}
            />

            {/* Content & Activity Grid */}
            <div className={`grid grid-cols-1 xl:grid-cols-3 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-300 ${isTenantAdmin ? 'gap-10' : 'gap-8'}`}>
                {/* Left Column (2/3 width on XL) */}
                <div className={`xl:col-span-2 min-w-0 ${isTenantAdmin ? 'space-y-10' : 'space-y-8'}`}>
                    <div className={`grid grid-cols-1 md:grid-cols-2 ${isTenantAdmin ? 'gap-10' : 'gap-8'}`}>
                        <ContentDistribution data={data.overview} />
                        <SystemHealth health={data.systemHealth} />
                    </div>

                    {/* Quick Links / Top Content - Neo-Glass style */}
                    <div className="min-w-0">
                        <TopBlogsWidget data={data.topContent} loading={loading} />
                    </div>
                </div>

                {/* Right Column (1/3 width on XL) - Activity Feed */}
                <div className={`min-w-0 ${isTenantAdmin ? 'space-y-10' : 'space-y-8'}`}>
                    <PluginWidgets position="sidebar" />
                    <UsageWidget />
                    <MyApprovals />
                    <ActivityFeed activities={data.activity} />
                </div>
            </div>
        </AdminPageLayout>
    );
}

export default AdminDashboard;
