/**
 * Analytics Widget Component
 * Compact widget for dashboard integration
 */

import { cn } from '@/lib/utils';

const AnalyticsWidget = ({ className = '' }) => {
    return (
        <div className={cn('bg-gradient-to-br from-blue-500 to-indigo-600 p-6 text-white', className)}>
            <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold">Quick Stats</h3>
                <span className="text-xs text-white/75">Today</span>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div>
                    <p className="text-2xl font-bold">1,234</p>
                    <p className="text-xs text-white/80">Page Views</p>
                </div>
                <div>
                    <p className="text-2xl font-bold">456</p>
                    <p className="text-xs text-white/80">Visitors</p>
                </div>
            </div>

            <a href="/admin/analytics" className="block mt-4 text-center text-xs font-medium text-white/80 hover:text-white">
                View Full Analytics →
            </a>
        </div>
    );
};

export default AnalyticsWidget;
