import React from 'react';

/**
 * LoadingSkeleton - Standardized loading skeleton components.
 * Provides consistent loading states across admin modules.
 * 
 * @param {string} type - Skeleton type: 'page', 'content', 'table', 'form', 'card'
 * @param {number} rows - Number of table rows (for type='table')
 * @param {number} cards - Number of cards (for type='card')
 */
const LoadingSkeleton = ({ type = 'content', rows = 5, cards = 3 }) => {
    const shimmer = 'animate-pulse bg-slate-200 rounded';

    if (type === 'page') {
        return (
            <div className="space-y-6" aria-busy="true" aria-label="Loading page">
                {/* Breadcrumb skeleton */}
                <div className="flex items-center gap-2">
                    <div className={`h-4 w-20 ${shimmer}`} />
                    <div className={`h-4 w-4 ${shimmer}`} />
                    <div className={`h-4 w-24 ${shimmer}`} />
                </div>

                {/* Header skeleton */}
                <div className="flex justify-between items-center">
                    <div className="space-y-2">
                        <div className={`h-8 w-48 ${shimmer}`} />
                        <div className={`h-4 w-64 ${shimmer}`} />
                    </div>
                    <div className={`h-10 w-32 ${shimmer}`} />
                </div>

                {/* Content skeleton */}
                <div className={`h-64 w-full ${shimmer}`} />
            </div>
        );
    }

    if (type === 'content') {
        return (
            <div className="space-y-4" aria-busy="true" aria-label="Loading content">
                <div className={`h-6 w-3/4 ${shimmer}`} />
                <div className={`h-4 w-full ${shimmer}`} />
                <div className={`h-4 w-5/6 ${shimmer}`} />
                <div className={`h-4 w-4/5 ${shimmer}`} />
            </div>
        );
    }

    if (type === 'table') {
        return (
            <div className="bg-card rounded-xl border border-border overflow-hidden" aria-busy="true" aria-label="Loading table">
                {/* Table header */}
                <div className="flex gap-4 p-4 border-b border-border bg-slate-50">
                    {[1, 2, 3, 4].map((i) => (
                        <div key={i} className={`h-4 flex-1 ${shimmer}`} />
                    ))}
                </div>

                {/* Table rows */}
                {Array.from({ length: rows }).map((_, rowIndex) => (
                    <div key={rowIndex} className="flex gap-4 p-4 border-b border-border last:border-b-0">
                        {[1, 2, 3, 4].map((i) => (
                            <div key={i} className={`h-4 flex-1 ${shimmer}`} />
                        ))}
                    </div>
                ))}
            </div>
        );
    }

    if (type === 'form') {
        return (
            <div className="space-y-6 bg-card rounded-xl border border-border p-6" aria-busy="true" aria-label="Loading form">
                {/* Form fields */}
                {[1, 2, 3].map((i) => (
                    <div key={i} className="space-y-2">
                        <div className={`h-4 w-24 ${shimmer}`} />
                        <div className={`h-10 w-full ${shimmer}`} />
                    </div>
                ))}

                {/* Form actions */}
                <div className="flex gap-2 pt-4">
                    <div className={`h-10 w-24 ${shimmer}`} />
                    <div className={`h-10 w-24 ${shimmer}`} />
                </div>
            </div>
        );
    }

    if (type === 'card') {
        return (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" aria-busy="true" aria-label="Loading cards">
                {Array.from({ length: cards }).map((_, i) => (
                    <div key={i} className="bg-card rounded-xl border border-border p-4 space-y-3">
                        <div className={`h-32 w-full ${shimmer}`} />
                        <div className={`h-5 w-3/4 ${shimmer}`} />
                        <div className={`h-4 w-full ${shimmer}`} />
                        <div className={`h-4 w-2/3 ${shimmer}`} />
                    </div>
                ))}
            </div>
        );
    }

    // Default fallback
    return (
        <div className={`h-12 w-full ${shimmer}`} aria-busy="true" aria-label="Loading" />
    );
};

export default LoadingSkeleton;
