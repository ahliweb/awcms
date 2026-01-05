import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePermissions } from '@/contexts/PermissionContext';

/**
 * PageHeader - Standardized header for admin pages.
 * Includes breadcrumbs, title, description, and action buttons with ABAC filtering.
 * 
 * @param {string} title - Page title
 * @param {string} description - Page description
 * @param {React.ComponentType} icon - Icon component for title
 * @param {Array} breadcrumbs - Array of {label, href, icon} objects
 * @param {Array} actions - Array of {label, onClick, icon, variant, permission} objects
 * @param {React.ReactNode} children - Additional content (e.g., tabs)
 */
const PageHeader = ({
    title,
    description,
    icon: TitleIcon,
    breadcrumbs = [],
    actions = [],
    children,
}) => {
    const { hasPermission } = usePermissions();

    // Filter actions based on permissions
    const visibleActions = actions.filter(action =>
        !action.permission || hasPermission(action.permission)
    );

    return (
        <div className="space-y-4">
            {/* Breadcrumb Navigation */}
            <nav className="flex items-center text-sm text-slate-500" aria-label="Breadcrumb">
                <ol className="flex items-center gap-1.5">
                    <li>
                        <Link
                            to="/cmspanel"
                            className="hover:text-blue-600 transition-colors flex items-center gap-1"
                        >
                            <Home className="w-4 h-4" />
                            <span className="sr-only sm:not-sr-only">Dashboard</span>
                        </Link>
                    </li>

                    {breadcrumbs.map((crumb, index) => (
                        <li key={index} className="flex items-center gap-1.5">
                            <ChevronRight className="w-4 h-4 text-slate-300" aria-hidden="true" />
                            {crumb.href ? (
                                <Link
                                    to={crumb.href}
                                    className="hover:text-blue-600 transition-colors flex items-center gap-1"
                                >
                                    {crumb.icon && <crumb.icon className="w-4 h-4" />}
                                    {crumb.label}
                                </Link>
                            ) : (
                                <span className="flex items-center gap-1 text-slate-700 font-medium" aria-current="page">
                                    {crumb.icon && <crumb.icon className="w-4 h-4" />}
                                    {crumb.label}
                                </span>
                            )}
                        </li>
                    ))}
                </ol>
            </nav>

            {/* Optional Tabs/Children */}
            {children}

            {/* Header with Title, Description, and Actions */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                        {TitleIcon && (
                            <TitleIcon className="w-6 h-6 text-blue-600" aria-hidden="true" />
                        )}
                        {title}
                    </h1>
                    {description && (
                        <p className="text-slate-500 mt-1">{description}</p>
                    )}
                </div>

                {visibleActions.length > 0 && (
                    <div className="flex items-center gap-2" role="toolbar" aria-label="Page actions">
                        {visibleActions.map((action, index) => (
                            <Button
                                key={index}
                                variant={action.variant || 'default'}
                                onClick={action.onClick}
                                className={action.className}
                                disabled={action.disabled}
                            >
                                {action.icon && <action.icon className="w-4 h-4 mr-2" aria-hidden="true" />}
                                {action.label}
                            </Button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default PageHeader;
