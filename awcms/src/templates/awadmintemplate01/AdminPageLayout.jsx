import React from 'react';
import { usePermissions } from '@/contexts/PermissionContext';
import { useTenant } from '@/contexts/TenantContext';
import NotAuthorized from './NotAuthorized';
import LoadingSkeleton from './LoadingSkeleton';
import TenantBadge from './TenantBadge';

/**
 * AdminPageLayout - Main page wrapper for admin modules.
 * Provides standardized structure with tenant context, permission checks, and loading states.
 * 
 * @param {string} requiredPermission - Permission required to view this page
 * @param {boolean} loading - Show loading skeleton
 * @param {React.ReactNode} children - Page content
 * @param {boolean} showTenantBadge - Show tenant context badge (default: true for platform admins)
 * @param {string} className - Additional CSS classes
 */
const AdminPageLayout = ({
    requiredPermission,
    loading = false,
    children,
    showTenantBadge = true,
    className = '',
}) => {
    const { hasPermission, isPlatformAdmin, loading: permLoading } = usePermissions();
    const { currentTenant, loading: tenantLoading } = useTenant();

    // Show skeleton while permissions/tenant are loading
    if (permLoading || tenantLoading) {
        return <LoadingSkeleton type="page" />;
    }

    // Check permission if required
    if (requiredPermission && !hasPermission(requiredPermission)) {
        return <NotAuthorized permission={requiredPermission} />;
    }

    return (
        <div className={`space-y-6 ${className}`}>
            {/* Tenant Context Badge for Platform Admins */}
            {showTenantBadge && isPlatformAdmin && (
                <div className="flex items-center justify-between">
                    <TenantBadge tenant={currentTenant} />
                </div>
            )}

            {/* Loading State */}
            {loading ? (
                <LoadingSkeleton type="content" />
            ) : (
                children
            )}
        </div>
    );
};

export default AdminPageLayout;
