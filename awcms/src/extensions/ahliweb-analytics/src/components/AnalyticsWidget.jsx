/**
 * Analytics Widget Component
 * Compact widget for dashboard integration
 */

import React from 'react';
import { cn } from '@/lib/utils';

const AnalyticsWidget = ({ className = '' }) => {
    return (
        <div className={cn('bg-gradient-to-br from-blue-500 to-indigo-600 p-4 text-white', className)}>
            <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">Quick Stats</h3>
                <span className="text-xs opacity-75">Today</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
                <div>
                    <p className="text-2xl font-bold">1,234</p>
                    <p className="text-xs opacity-75">Page Views</p>
                </div>
                <div>
                    <p className="text-2xl font-bold">456</p>
                    <p className="text-xs opacity-75">Visitors</p>
                </div>
            </div>

            <a href="/admin/analytics" className="block mt-3 text-center text-xs opacity-75 hover:opacity-100">
                View Full Analytics →
            </a>
        </div>
    );
};

export default AnalyticsWidget;
