
import { useTenant } from '@/contexts/TenantContext';
import { Button } from '@/components/ui/button';

const TenantGuard = ({ children }) => {
    const { currentTenant, loading, error } = useTenant();

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        );
    }

    if (error || !currentTenant) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
                <div className="w-full max-w-md p-8 space-y-4 text-center bg-white rounded-lg shadow">
                    <h1 className="text-2xl font-bold text-red-600">Access Denied</h1>
                    <p className="text-gray-600">
                        {error || "We couldn't identify the workspace you're trying to access."}
                    </p>
                    <div className="border-t pt-4 mt-4">
                        <p className="text-sm text-gray-500 mb-4">
                            If you believe this is an error, please contact support.
                        </p>
                        <Button variant="outline" onClick={() => window.location.reload()}>
                            Retry Connection
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    // currentTenant comes from TenantResolutionResult (new) or legacy shape.
    // New shape uses tenantStatus (camelCase); legacy shape used .status.
    const tenantStatus = currentTenant.tenantStatus ?? currentTenant.status;
    const tenantLabel  = currentTenant.tenantCode   ?? currentTenant.name ?? 'this workspace';

    if (tenantStatus !== 'active' && tenantStatus !== 'migrating') {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
                <div className="w-full max-w-md p-8 space-y-4 text-center bg-white rounded-lg shadow">
                    <h1 className="text-2xl font-bold text-amber-600">Workspace Suspended</h1>
                    <p className="text-gray-600">
                        This workspace ({tenantLabel}) is currently suspended.
                    </p>
                    <Button className="mt-4" onClick={() => window.location.href = 'mailto:support@awcms.com'}>
                        Contact Support
                    </Button>
                </div>
            </div>
        );
    }

    return children;
};

export default TenantGuard;
