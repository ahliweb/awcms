import React from 'react';
import { buildRegionPath } from '../../lib/regionUtils';

/**
 * Region Breadcrumb Component
 * Displays the full hierarchical path of a region
 */
const RegionBreadcrumb = ({ region, ancestors = [], className = '' }) => {
    if (!region) return null;

    const fullPath = region.full_path || buildRegionPath(ancestors, region);

    return (
        <div className={`text-sm text-gray-500 ${className}`}>
            {fullPath}
        </div>
    );
};

export default RegionBreadcrumb;
