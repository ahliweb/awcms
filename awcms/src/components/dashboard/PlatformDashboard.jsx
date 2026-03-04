import React from 'react';
import { useTranslation } from 'react-i18next';
import {
    Building2, Users, HardDrive, ShieldCheck,
    Activity, ArrowRight, LayoutGrid, Globe
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';
import { Button } from '@/components/ui/button';

function PlatformDashboard() {
    const { t } = useTranslation();

    // In a real implementation, you would fetch these from an RPC or a platform-specific API
    const mockStats = [
        { label: 'Total Tenants', value: '12', icon: Building2, color: 'text-blue-500', bg: 'bg-blue-500/10' },
        { label: 'Platform Users', value: '1,245', icon: Users, color: 'text-indigo-500', bg: 'bg-indigo-500/10' },
        { label: 'Active Modules', value: '8', icon: LayoutGrid, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
        { label: 'System Health', value: '99.9%', icon: Activity, color: 'text-teal-500', bg: 'bg-teal-500/10' }
    ];

    return (
        <AdminPageLayout requiredPermission="platform.tenant.read">
            <PageHeader
                title="Platform Overview"
                description="Global system management and cross-tenant overview."
                icon={Globe}
                breadcrumbs={[]}
            />

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
                {mockStats.map((stat, i) => {
                    const Icon = stat.icon;
                    return (
                        <div key={i} className="rounded-2xl border border-border/60 bg-card/65 p-4 shadow-sm backdrop-blur-sm">
                            <div className="flex items-center gap-4">
                                <div className={`p-3 rounded-xl ${stat.bg}`}>
                                    <Icon className={`w-6 h-6 ${stat.color}`} />
                                </div>
                                <div>
                                    <p className="text-sm font-medium text-muted-foreground">{stat.label}</p>
                                    <p className="text-2xl font-semibold">{stat.value}</p>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                <div className="rounded-2xl border border-border/60 bg-card/65 p-6 shadow-sm backdrop-blur-sm">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="p-2 bg-primary/10 rounded-lg text-primary">
                            <ShieldCheck className="w-5 h-5" />
                        </div>
                        <h3 className="text-lg font-semibold">Platform Management</h3>
                    </div>
                    <p className="text-muted-foreground text-sm mb-6">
                        Access global settings that affect all tenants across the platform. These defaults can be overridden by individual tenants if permitted.
                    </p>
                    <div className="flex flex-col gap-3">
                        <Button asChild variant="outline" className="justify-between">
                            <Link to="/cmspanel/platform/settings">
                                Platform Settings <ArrowRight className="w-4 h-4 ml-2" />
                            </Link>
                        </Button>
                        <Button asChild variant="outline" className="justify-between">
                            <Link to="/cmspanel/tenants">
                                Tenant Management <ArrowRight className="w-4 h-4 ml-2" />
                            </Link>
                        </Button>
                        <Button asChild variant="outline" className="justify-between">
                            <Link to="/cmspanel/modules">
                                Global Modules <ArrowRight className="w-4 h-4 ml-2" />
                            </Link>
                        </Button>
                    </div>
                </div>

                <div className="rounded-2xl border border-border/60 bg-card/65 p-6 shadow-sm backdrop-blur-sm">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-500">
                            <HardDrive className="w-5 h-5" />
                        </div>
                        <h3 className="text-lg font-semibold">System Details</h3>
                    </div>
                    <div className="space-y-4 text-sm">
                        <div className="flex justify-between py-2 border-b border-border/50">
                            <span className="text-muted-foreground">Database Size</span>
                            <span className="font-medium">2.4 GB</span>
                        </div>
                        <div className="flex justify-between py-2 border-b border-border/50">
                            <span className="text-muted-foreground">API Latency</span>
                            <span className="font-medium">~45ms</span>
                        </div>
                        <div className="flex justify-between py-2 border-b border-border/50">
                            <span className="text-muted-foreground">Active Connections</span>
                            <span className="font-medium">124</span>
                        </div>
                        <div className="flex justify-between py-2">
                            <span className="text-muted-foreground">Last Backup</span>
                            <span className="font-medium">2 hours ago</span>
                        </div>
                    </div>
                </div>
            </div>
        </AdminPageLayout>
    );
}

export default PlatformDashboard;
