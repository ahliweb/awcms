
import { Link } from 'react-router-dom';
import { RefreshCw, Calendar, ChevronRight, FileText, Home, Layers3, ShieldCheck, Users2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDashboardData } from '@/hooks/useDashboardData';
import { usePermissions } from '@/contexts/PermissionContext';
import { useTenant } from '@/contexts/TenantContext';
import { StatCards } from './widgets/StatCards';
import { ActivityFeed } from './widgets/ActivityFeed';
import { ContentDistribution } from './widgets/ContentDistribution';
import { SystemHealth } from './widgets/SystemHealth';
import { PluginSlot } from '@/contexts/PluginContext';
import { PlatformOverview } from './widgets/PlatformOverview';
import { MyApprovals } from './widgets/MyApprovals';
import { UsageWidget } from './widgets/UsageWidget';
import { TopBlogsWidget } from './widgets/TopBlogsWidget';
import PluginWidgets from './widgets/PluginWidgets';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

function AdminDashboard() {
    const perms = usePermissions() || {};
    const { isPlatformAdmin, userRole } = perms;
    const { currentTenant } = useTenant();
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

    const getGreeting = () => {
        const hour = new Date().getHours();
        if (hour < 5) return 'Good Night';
        if (hour < 12) return 'Good Morning';
        if (hour < 18) return 'Good Afternoon';
        return 'Good Evening';
    };

    const headerActions = (
        <div className="flex flex-wrap items-center gap-2 md:justify-end">
            <Button
                onClick={refresh}
                variant="outline"
                className={cn(
                    'h-10 rounded-xl border-border/70 bg-background px-4 text-muted-foreground shadow-sm transition-colors hover:bg-accent/70 hover:text-foreground',
                    loading && 'opacity-70'
                )}
            >
                <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
                Refresh Data
            </Button>
        </div>
    );

    const summaryCards = [
        {
            title: 'Content Assets',
            value: contentTotal,
            description: `${data?.overview?.blogs || 0} blogs and ${data?.overview?.pages || 0} pages available across the current scope.`,
            accent: 'from-primary/15 via-primary/6 to-transparent',
        },
        {
            title: 'Team Members',
            value: teamSize,
            description: `${data?.overview?.orders || 0} orders currently tracked through the admin workspace.`,
            accent: 'from-sky-500/15 via-sky-500/6 to-transparent',
        },
        {
            title: 'System Pulse',
            value: isHealthy ? 'Stable' : 'Needs Review',
            description: `${activityItems} recent activity events across connected modules.`,
            accent: isHealthy ? 'from-emerald-500/15 via-emerald-500/6 to-transparent' : 'from-destructive/15 via-destructive/6 to-transparent',
        },
    ];

    if (error) {
        return (
            <div className="space-y-6">
                <nav className="mb-6">
                    <ol className="flex flex-wrap items-center gap-1.5 break-words text-sm text-muted-foreground sm:gap-2.5">
                        <li className="inline-flex items-center gap-1.5">
                            <Link to="/cmspanel" className="flex items-center gap-1 transition-colors hover:text-foreground">
                                <Home className="h-4 w-4" />
                                Dashboard
                            </Link>
                        </li>
                    </ol>
                </nav>
                <div className="mx-auto mt-20 max-w-2xl rounded-2xl border border-destructive/25 bg-destructive/5 p-8 text-center shadow-sm backdrop-blur-sm">
                    <p className="mb-2 text-lg font-semibold text-destructive">Something went wrong</p>
                    <p className="mb-6 text-sm text-muted-foreground">{error}</p>
                    <Button onClick={refresh} variant="outline" className="border-destructive/30 text-destructive hover:bg-destructive/10">
                        Try Again
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className={cn('space-y-6', layoutClass)}>
            <nav className="mb-6">
                <ol className="flex flex-wrap items-center gap-1.5 break-words text-sm text-muted-foreground sm:gap-2.5">
                    <li className="inline-flex items-center gap-1.5">
                        <Link to="/cmspanel" className="flex items-center gap-1 transition-colors hover:text-foreground">
                            <Home className="h-4 w-4" />
                            Dashboard
                        </Link>
                    </li>
                    <li aria-hidden="true" className="[&>svg]:size-3.5"><ChevronRight /></li>
                    <li className="inline-flex items-center gap-1.5">
                        <div className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 font-medium text-primary-foreground shadow-sm">
                            <span>Overview</span>
                        </div>
                    </li>
                </ol>
            </nav>

            <div className={spacingClass}>
                <div className="space-y-8">
                    <div className="rounded-3xl border border-border/70 bg-gradient-to-br from-background via-background to-primary/5 p-6 shadow-sm">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div className="space-y-1.5">
                                <div className="flex items-center gap-3">
                                    <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-sm">
                                        <Layers3 className="h-5 w-5" />
                                    </span>
                                    <div>
                                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Dashboard</p>
                                        <p className="text-lg font-semibold text-foreground">{`${getGreeting()}, ${roleLabel}`}</p>
                                    </div>
                                </div>
                                <p className="max-w-3xl text-sm text-muted-foreground">{`Here's your performance overview for ${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}.`}</p>
                            </div>
                            {headerActions}
                        </div>

                        <div className="mt-5 flex flex-wrap gap-3 text-sm text-muted-foreground">
                            <span className="inline-flex items-center gap-2 rounded-full bg-background/70 px-3 py-1.5 shadow-sm">
                                <Layers3 className="h-4 w-4 text-primary" />
                                /cmspanel dashboard shell
                            </span>
                            <span className="inline-flex items-center gap-2 rounded-full bg-background/70 px-3 py-1.5 shadow-sm">
                                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                                {isPlatformAdmin ? 'Platform scope active' : `Tenant scope: ${currentTenant?.name || 'Current tenant'}`}
                            </span>
                            <span className="inline-flex items-center gap-2 rounded-full bg-background/70 px-3 py-1.5 shadow-sm">
                                <Calendar className="h-4 w-4 text-primary" />
                                Last updated: {lastUpdatedLabel}
                            </span>
                        </div>
                    </div>

                    <div className="rounded-[28px] border border-border/60 bg-gradient-to-br from-muted/50 via-background to-background p-3 shadow-sm">
                        <div className="grid gap-4 md:grid-cols-3">
                            {summaryCards.map((card) => (
                                <Card key={card.title} className="overflow-hidden rounded-2xl border-border/70 shadow-sm">
                                    <CardContent className="relative p-5">
                                        <div className={cn('pointer-events-none absolute inset-0 bg-gradient-to-br', card.accent)} />
                                        <div className="relative">
                                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{card.title}</p>
                                            <p className="mt-3 text-4xl font-semibold leading-none text-foreground">{card.value}</p>
                                            <p className="mt-3 max-w-xs text-sm leading-6 text-muted-foreground">{card.description}</p>
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    </div>
                </div>

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
                    <PluginSlot name="dashboard_top" args={[userRole]} />
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
        </div>
    );
}

export default AdminDashboard;
