import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldAlert, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * NotAuthorized - Standardized access denied page.
 * Displayed when user lacks required permissions.
 * 
 * @param {string} permission - The permission that was required
 * @param {string} title - Custom title
 * @param {string} description - Custom description
 * @param {boolean} showBackButton - Show back to dashboard button
 */
const NotAuthorized = ({
    permission,
    title = 'Access Denied',
    description = 'You do not have permission to view this page.',
    showBackButton = true,
}) => {
    return (
        <div
            className="flex flex-col items-center justify-center min-h-[400px] bg-card rounded-xl border border-border p-12 text-center"
            role="alert"
            aria-live="assertive"
        >
            <div className="p-4 bg-destructive/10 rounded-full mb-4">
                <ShieldAlert className="w-12 h-12 text-destructive" aria-hidden="true" />
            </div>

            <h1 className="text-xl font-bold text-foreground">{title}</h1>
            <p className="text-muted-foreground mt-2 max-w-md">{description}</p>

            {permission && (
                <p className="text-xs text-muted-foreground mt-4 font-mono bg-muted px-3 py-1 rounded">
                    Required: {permission}
                </p>
            )}

            {showBackButton && (
                <Button asChild className="mt-6" variant="outline">
                    <Link to="/cmspanel">
                        <ArrowLeft className="w-4 h-4 mr-2" aria-hidden="true" />
                        Back to Dashboard
                    </Link>
                </Button>
            )}
        </div>
    );
};

export default NotAuthorized;
