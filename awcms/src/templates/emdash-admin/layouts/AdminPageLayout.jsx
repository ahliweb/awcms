import React from 'react';
import { usePermissions } from '@/contexts/PermissionContext';
import { useTenant } from '@/contexts/TenantContext';
import { cn } from '@/lib/utils';

const AdminPageLayout = ({
    requiredPermission,
    loading = false,
    children,
    className = '',
    unwrapped = false,
}) => {
    const { hasPermission, hasAnyPermission, isPlatformAdmin, loading: permLoading } = usePermissions();
    const { currentTenant, loading: tenantLoading } = useTenant();

    const isLoading = loading || permLoading || tenantLoading;

    // Check permissions
    // If requiredPermission is an array, user needs ANY of them (OR logic)
    // If string, user needs that specific one
    const hasAccess = React.useMemo(() => {
        if (!requiredPermission) return true;
        if (Array.isArray(requiredPermission)) {
            return hasAnyPermission(requiredPermission);
        }
        return hasPermission(requiredPermission);
    }, [requiredPermission, hasPermission, hasAnyPermission]);

    if (!permLoading && !hasAccess) {
        return (
            <div
                className="mb-4 rounded-[1.5rem] border border-destructive/25 bg-destructive/8 px-4 py-3 text-sm text-destructive shadow-sm"
                role="alert"
            >
                <span className="font-semibold">Access denied.</span> You do not have permission to view this page.
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="emdash-panel grid min-h-[420px] place-items-center p-8">
                <div className="text-center text-muted-foreground">
                    <div role="status">
                        <svg aria-hidden="true" className="inline w-8 h-8 text-muted-foreground animate-spin fill-primary" viewBox="0 0 100 101" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z" fill="currentColor" />
                            <path d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z" fill="currentFill" />
                        </svg>
                        <span className="sr-only">Loading...</span>
                    </div>
                    <p className="mt-3 text-sm font-medium">Loading module data...</p>
                </div>
            </div>
        );
    }

    if (unwrapped) {
        return <div className={cn("space-y-8", className)}>{children}</div>;
    }

    return (
            <div
                className={cn(
                "emdash-panel relative space-y-8 overflow-hidden p-6 sm:p-8",
                className
            )}
        >
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.14),_transparent_42%),radial-gradient(circle_at_top_right,_rgba(129,140,248,0.12),_transparent_38%)] dark:bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.16),_transparent_40%),radial-gradient(circle_at_top_right,_rgba(129,140,248,0.16),_transparent_35%)]" />
            <div className="relative z-10">
                {children}
            </div>
        </div>
    );
};

export default AdminPageLayout;
