/**
 * Analytics Dashboard Component
 * Main dashboard view for the Analytics extension
 */

import { useState, useEffect } from 'react';

const AnalyticsDashboard = ({ supabase: _supabase, tenantId: _tenantId}) => {
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({
        pageViews: 0,
        uniqueVisitors: 0,
        avgSessionDuration: '0m',
        bounceRate: '0%'
    });

    useEffect(() => {
        // Simulate loading analytics data
        const timer = setTimeout(() => {
            setStats({
                pageViews: 12450,
                uniqueVisitors: 3240,
                avgSessionDuration: '4m 32s',
                bounceRate: '42%'
            });
            setLoading(false);
        }, 1000);

        return () => clearTimeout(timer);
    }, []);

    if (loading) {
        return (
            <div className="animate-pulse space-y-4">
                <div className="h-8 w-64 bg-gray-200 rounded"></div>
                <div className="grid grid-cols-4 gap-4">
                    {[1, 2, 3, 4].map(i => (
                        <div key={i} className="h-24 bg-gray-200 rounded-lg"></div>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold">Analytics Dashboard</h1>
                <p className="text-gray-500">Track visitor activity and engagement</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                    title="Page Views"
                    value={stats.pageViews.toLocaleString()}
                    icon="📊"
                    trend="+12%"
                />
                <StatCard
                    title="Unique Visitors"
                    value={stats.uniqueVisitors.toLocaleString()}
                    icon="👥"
                    trend="+8%"
                />
                <StatCard
                    title="Avg. Session"
                    value={stats.avgSessionDuration}
                    icon="⏱️"
                    trend="+5%"
                />
                <StatCard
                    title="Bounce Rate"
                    value={stats.bounceRate}
                    icon="↩️"
                    trend="-3%"
                    trendPositive={true}
                />
            </div>

            <div className="bg-white rounded-lg border p-6">
                <h2 className="text-lg font-semibold mb-4">Traffic Overview</h2>
                <div className="h-64 flex items-center justify-center text-gray-400">
                    [Chart placeholder - integrate with actual analytics data]
                </div>
            </div>
        </div>
    );
};

const StatCard = ({ title, value, icon, trend, trendPositive = false }) => (
    <div className="bg-white rounded-lg border p-4">
        <div className="flex items-center justify-between">
            <span className="text-2xl">{icon}</span>
            <span className={`text-sm font-medium ${trend.startsWith('+') && !trendPositive ? 'text-green-600' :
                    trend.startsWith('-') && trendPositive ? 'text-green-600' :
                        'text-red-600'
                }`}>
                {trend}
            </span>
        </div>
        <p className="mt-2 text-2xl font-bold">{value}</p>
        <p className="text-gray-500 text-sm">{title}</p>
    </div>
);

export default AnalyticsDashboard;
