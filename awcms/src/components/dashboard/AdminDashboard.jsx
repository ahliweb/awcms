
import React from 'react';
import { RefreshCw, Calendar, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useDashboardData } from '@/hooks/useDashboardData';
import { usePermissions } from '@/contexts/PermissionContext';
import { StatCards } from './widgets/StatCards';
import { ActivityFeed } from './widgets/ActivityFeed';
import { ContentDistribution } from './widgets/ContentDistribution';
import { SystemHealth } from './widgets/SystemHealth';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
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

    const getGreeting = () => {
        const hour = new Date().getHours();
        if (hour < 12) return 'Good Morning';
        if (hour < 18) return 'Good Afternoon';
        return 'Good Evening';
    };

    const formattedDate = format(new Date(), 'EEEE, MMMM do, yyyy');

    const headerActions = [
        {
            label: 'Refresh',
            icon: RefreshCw,
            onClick: refresh,
            variant: 'outline',
            className: loading ? 'opacity-70' : ''
        }
    ];

    if (error) {
        return (
            <AdminPageLayout>
                <div className="p-8 text-center bg-red-50 text-red-600 rounded-xl border border-red-100">
                    <p>{error}</p>
                    <Button onClick={refresh} variant="outline" className="mt-4 border-red-200 hover:bg-red-100">
                        Try Again
                    </Button>
                </div>
            </AdminPageLayout>
        );
    }

    return (
        <AdminPageLayout>
            <PageHeader
                title={`${getGreeting()}, ${userRole?.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()) || 'User'} 👋`}
                description={`Here's what's happening today. Updated: ${lastUpdated.toLocaleTimeString()}`}
                actions={headerActions}
                breadcrumbs={[{ label: 'Dashboard', href: '/cmspanel' }]} // Self-link or just text
            />

            {/* Platform Overview for Global Roles (Owner & Super Admin) */}
            {(userRole === 'owner' || userRole === 'super_admin') && (
                <PlatformOverview />
            )}

            {/* Main Stats Grid */}
            <StatCards data={data.overview} loading={loading} />

            {/* Plugin Hook: Dashboard Top */}
            <div className="w-full">
                <PluginAction name="dashboard_top" args={[userRole]} />
            </div>

            {/* Content & Activity Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left Column (2/3 width) */}
                <div className="lg:col-span-2 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <ContentDistribution data={data.overview} />
                        <SystemHealth health={data.systemHealth} />
                    </div>

                    {/* Quick Links / Top Content */}
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="font-bold text-slate-800">Top Performing Articles</h3>
                            <Link to="/cmspanel/articles" className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center">
                                View All <ArrowRight className="w-4 h-4 ml-1" />
                            </Link>
                        </div>
                        <div className="space-y-4">
                            {loading ? (
                                [...Array(3)].map((_, i) => (
                                    <div key={i} className="flex items-center justify-between p-3 bg-white rounded-lg border border-slate-100">
                                        <div className="space-y-2 w-full">
                                            <Skeleton className="h-4 w-3/4 bg-slate-100" />
                                            <Skeleton className="h-3 w-1/2 bg-slate-50" />
                                        </div>
                                    </div>
                                ))
                            ) : data.topContent.length > 0 ? (
                                data.topContent.map((article, i) => (
                                    <div key={i} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors">
                                        <span className="font-medium text-slate-700 truncate max-w-[200px] sm:max-w-md">
                                            {article.title}
                                        </span>
                                        <div className="flex items-center gap-4 text-sm">
                                            <span className="text-slate-500">{article.views || 0} views</span>
                                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${article.status === 'published' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                                                {article.status}
                                            </span>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <p className="text-slate-400 text-center py-4">No articles found.</p>
                            )}
                        </div>
                    </div>
                </div>

                {/* Right Column (1/3 width) - Activity Feed */}
                <div className="space-y-6">
                    <UsageWidget />
                    <MyApprovals />
                    <ActivityFeed activities={data.activity} />
                </div>
            </div>
        </AdminPageLayout>
    );
}

export default AdminDashboard;
