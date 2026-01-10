import React from 'react';
import { usePermissions } from '@/contexts/PermissionContext';
import { useTenant } from '@/contexts/TenantContext';
import NotAuthorized from './NotAuthorized';
import LoadingSkeleton from './LoadingSkeleton';
import TenantBadge from './TenantBadge';

/**
 * AdminPageLayout - Futuristic Neo-Glass Wrapper
 * Provides standardized structure with a modern mesh gradient background.
 * 
 * @param {string} requiredPermission - Permission required to view this page
 * @param {boolean} loading - Show loading skeleton
 * @param {React.ReactNode} children - Page content
 * @param {boolean} showTenantBadge - Show tenant context badge
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
        <div className="min-h-screen bg-slate-50 relative overflow-hidden font-sans text-slate-900 selection:bg-blue-100 selection:text-blue-900">
            {/* Futuristic Background Mesh */}
            <div className="fixed inset-0 z-0 pointer-events-none">
                <div className="absolute top-[-10%] -left-20 w-96 h-96 bg-blue-400/20 rounded-full blur-3xl mix-blend-multiply animate-blob"></div>
                <div className="absolute top-[-10%] right-[-10%] w-96 h-96 bg-purple-400/20 rounded-full blur-3xl mix-blend-multiply animate-blob animation-delay-2000"></div>
                <div className="absolute top-[20%] left-[20%] w-96 h-96 bg-indigo-400/20 rounded-full blur-3xl mix-blend-multiply animate-blob animation-delay-4000"></div>
                <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-sky-100/40 rounded-full blur-[100px]"></div>
            </div>

            {/* Main Content Container */}
            <div className={`relative z-10 container max-w-7xl mx-auto p-4 md:p-8 space-y-8 ${className}`}>

                {/* Global Tenant Context (Floating Badge) */}
                {showTenantBadge && isPlatformAdmin && (
                    <div className="absolute top-4 right-4 md:right-8 z-50">
                        <TenantBadge tenant={currentTenant} />
                    </div>
                )}

                {/* Content Area */}
                <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
                    {loading ? (
                        <LoadingSkeleton type="content" />
                    ) : (
                        children
                    )}
                </div>
            </div>
        </div>
    );
};

export default AdminPageLayout;
