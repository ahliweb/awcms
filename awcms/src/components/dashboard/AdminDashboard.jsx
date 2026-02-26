
import { RefreshCw, LayoutGrid, Calendar, FileText, Users2, ShieldCheck } from 'lucide-react';
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
    const { isPlatformAdmin, userRole } = perms;
    const { data, loading, error, lastUpdated, refresh } = useDashboardData();
    const spacingClass = 'space-y-7 lg:space-y-9';
    const layoutClass = 'w-full';
    const gridGap = 'gap-6 lg:gap-8';
    const columnSpacing = 'space-y-6 lg:space-y-8';
    const roleLabel = userRole?.replace('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase()) || 'User';
    const lastUpdatedLabel = lastUpdated instanceof Date ? lastUpdated.toLocaleTimeString() : '-';
    const contentTotal = Number(data?.overview?.blogs || 0) + Number(data?.overview?.pages || 0) + Number(data?.overview?.products || 0);
    const teamSize = Number(data?.overview?.users || 0);
    const activityItems = Number(data?.activity?.length || 0);
    const isHealthy = data?.systemHealth?.database === 'connected' && data?.systemHealth?.api === 'operational';

    const heroSignals = [
        {
            label: 'Content Assets',
            value: contentTotal,
            hint: `${data?.overview?.blogs || 0} blogs / ${data?.overview?.pages || 0} pages`,
            icon: FileText,
            iconClassName: 'border-primary/25 bg-primary/10 text-primary',
        },
        {
            label: 'Team Members',
            value: teamSize,
            hint: `${data?.overview?.orders || 0} orders in tracking`,
            icon: Users2,
            iconClassName: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
        },
        {
            label: 'System Pulse',
            value: isHealthy ? 'Stable' : 'Needs Review',
            hint: `${activityItems} recent activity events`,
            icon: ShieldCheck,
            iconClassName: isHealthy
                ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300',
        },
    ];

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
            className={cn(
                'h-10 rounded-xl border-border/70 bg-background/80 px-4 text-muted-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-accent/70 hover:text-foreground',
                loading && 'opacity-70'
            )}
        >
            <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
            Refresh Data
        </Button>
    );

    if (error) {
        return (
            <AdminPageLayout>
                <div className="mx-auto mt-20 max-w-2xl rounded-2xl border border-destructive/25 bg-destructive/5 p-8 text-center shadow-sm backdrop-blur-sm">
                    <p className="mb-2 text-lg font-semibold text-destructive">Something went wrong</p>
                    <p className="mb-6 text-sm text-muted-foreground">{error}</p>
                    <Button onClick={refresh} variant="outline" className="border-destructive/30 text-destructive hover:bg-destructive/10">
                        Try Again
                    </Button>
                </div>
            </AdminPageLayout>
        );
    }

    return (
        <AdminPageLayout className={layoutClass}>
            <div className={spacingClass}>
                <PageHeader
                    title={`${getGreeting()}, ${roleLabel}`}
                    description={`Here's your performance overview for ${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}.`}
                    icon={LayoutGrid}
                    actions={headerActions}
                >
                    <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">
                                {isPlatformAdmin ? 'Platform Scope' : 'Tenant Scope'}
                            </span>
                            <span className="inline-flex items-center rounded-full border border-border/70 bg-background/70 px-3 py-1.5 text-xs font-medium text-muted-foreground">
                                {loading ? 'Refreshing' : 'Live Data'}
                            </span>
                        </div>

                        <div className="grid gap-2 sm:grid-cols-3">
                            {heroSignals.map((signal) => {
                                const SignalIcon = signal.icon;
                                return (
                                    <div key={signal.label} className="rounded-xl border border-border/70 bg-background/70 p-3">
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{signal.label}</p>
                                                <p className="mt-1 text-lg font-semibold text-foreground">{signal.value}</p>
                                                <p className="text-xs text-muted-foreground">{signal.hint}</p>
                                            </div>
                                            <span className={cn('rounded-lg border p-1.5', signal.iconClassName)}>
                                                <SignalIcon className="h-3.5 w-3.5" />
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="flex w-fit items-center gap-2 rounded-full border border-border/70 bg-background/60 px-3 py-1.5 text-sm text-muted-foreground backdrop-blur-sm">
                            <Calendar className="w-3 h-3" />
                            <span>Last updated: {lastUpdatedLabel}</span>
                        </div>
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
                    />
                </div>

                {/* Plugin Hook: Dashboard Top */}
                <div className="w-full">
                    <PluginAction name="dashboard_top" args={[userRole]} />
                </div>

                <PluginWidgets
                    position="main"
                    layout="grid"
                    className={cn('animate-in fade-in slide-in-from-bottom-4 duration-700 delay-250 grid-cols-1 md:grid-cols-2', gridGap)}
                />

                {/* Content & Activity Grid */}
                <div className={cn('grid grid-cols-1 xl:grid-cols-3 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-300', gridGap)}>
                    {/* Left Column (2/3 width on XL) */}
                    <div className={cn('xl:col-span-2 min-w-0', columnSpacing)}>
                        <div className={cn('grid grid-cols-1 md:grid-cols-2', gridGap)}>
                            <ContentDistribution data={data.overview} />
                            <SystemHealth health={data.systemHealth} />
                        </div>

                        {/* Quick Links / Top Content - Neo-Glass style */}
                        <div className="min-w-0">
                            <TopBlogsWidget data={data.topContent} loading={loading} />
                        </div>
                    </div>

                    {/* Right Column (1/3 width on XL) - Activity Feed */}
                    <div className={cn('min-w-0', columnSpacing)}>
                        <PluginWidgets position="sidebar" />
                        <UsageWidget />
                        <MyApprovals />
                        <ActivityFeed activities={data.activity} />
                    </div>
                </div>
            </div>
        </AdminPageLayout>
    );
}

export default AdminDashboard;
