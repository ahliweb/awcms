/**
 * Analytics Widget Component
 * Compact widget for dashboard integration
 */

import { cn } from '../../../../lib/utils';
import { ArrowRight } from 'lucide-react';

const AnalyticsWidget = ({ className = '' }) => {
    return (
        <div className={cn('rounded-xl border border-white/10 bg-gradient-to-br from-blue-500 to-indigo-600 p-4 text-white shadow-inner', className)}>
            <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-white/70">
                <span>Quick Snapshot</span>
                <span>Live</span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-4">
                <div>
                    <p className="text-2xl font-bold">1,234</p>
                    <p className="text-xs text-white/80">Page Views</p>
                </div>
                <div>
                    <p className="text-2xl font-bold">456</p>
                    <p className="text-xs text-white/80">Visitors</p>
                </div>
            </div>

            <a href="/cmspanel/analytics" className="mt-4 inline-flex w-full items-center justify-center gap-1 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold text-white/90 transition-colors hover:bg-white/20">
                View Full Analytics <ArrowRight className="h-3 w-3" />
            </a>
        </div>
    );
};

export default AnalyticsWidget;
