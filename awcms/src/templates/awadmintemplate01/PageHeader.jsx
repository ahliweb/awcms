import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePermissions } from '@/contexts/PermissionContext';

/**
 * PageHeader - Futuristic & Clean Header
 * Includes breadcrumbs, title with modern typography, and action buttons with glass/glow effects.
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
        <div className="space-y-6">
            {/* Elegant Breadcrumb Navigation */}
            <nav className="flex items-center text-sm font-medium text-slate-500" aria-label="Breadcrumb">
                <ol className="flex items-center gap-2">
                    <li>
                        <Link
                            to="/cmspanel"
                            className="bg-white/50 hover:bg-white text-slate-500 hover:text-blue-600 px-2 py-1 rounded-md transition-all duration-200 flex items-center gap-1.5 backdrop-blur-sm border border-transparent hover:border-slate-200"
                        >
                            <Home className="w-4 h-4" />
                            <span className="sr-only sm:not-sr-only">Dashboard</span>
                        </Link>
                    </li>

                    {breadcrumbs.map((crumb, index) => (
                        <li key={index} className="flex items-center gap-2">
                            <ChevronRight className="w-4 h-4 text-slate-300" aria-hidden="true" />
                            {crumb.href ? (
                                <Link
                                    to={crumb.href}
                                    className="hover:text-blue-600 transition-colors flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-white/50"
                                >
                                    {crumb.icon && <crumb.icon className="w-4 h-4" />}
                                    {crumb.label}
                                </Link>
                            ) : (
                                <span className="flex items-center gap-1.5 text-slate-800 font-semibold px-2" aria-current="page">
                                    {crumb.icon && <crumb.icon className="w-4 h-4" />}
                                    {crumb.label}
                                </span>
                            )}
                        </li>
                    ))}
                </ol>
            </nav>

            {/* Header Content */}
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 pb-2 border-b border-slate-200/50">
                <div className="space-y-2">
                    <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-slate-900 flex items-center gap-3">
                        {TitleIcon && (
                            <div className="p-2 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-lg shadow-blue-500/20">
                                <TitleIcon className="w-7 h-7" aria-hidden="true" />
                            </div>
                        )}
                        <span className="bg-clip-text text-transparent bg-gradient-to-r from-slate-900 via-slate-800 to-slate-600">
                            {title}
                        </span>
                    </h1>
                    {description && (
                        <p className="text-lg text-slate-500 max-w-3xl leading-relaxed">
                            {description}
                        </p>
                    )}
                </div>

                {visibleActions.length > 0 && (
                    <div className="flex items-center gap-3" role="toolbar" aria-label="Page actions">
                        {visibleActions.map((action, index) => (
                            <Button
                                key={index}
                                variant={action.variant || 'default'}
                                onClick={action.onClick}
                                className={`
                                    relative overflow-hidden transition-all duration-300 transform hover:-translate-y-0.5 hover:shadow-lg
                                    ${!action.variant || action.variant === 'default'
                                        ? 'bg-gradient-to-r from-slate-900 to-slate-800 hover:from-blue-600 hover:to-indigo-600 border-0 shadow-slate-900/20'
                                        : 'bg-white/70 backdrop-blur-sm border-slate-200 hover:border-blue-300 hover:bg-white'}
                                    ${action.className}
                                `}
                                disabled={action.disabled}
                            >
                                {action.icon && <action.icon className="w-4 h-4 mr-2" aria-hidden="true" />}
                                {action.label}
                            </Button>
                        ))}
                    </div>
                )}
            </div>

            {/* Optional Tabs/Children Area */}
            {children && (
                <div className="mt-6">
                    {children}
                </div>
            )}
        </div>
    );
};

export default PageHeader;
