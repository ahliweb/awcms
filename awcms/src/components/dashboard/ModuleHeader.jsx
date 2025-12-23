import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * ModuleHeader - Standardized header component for admin modules.
 * Provides consistent breadcrumb navigation, title, description, and action buttons.
 *
 * @param {string} title - Main module title
 * @param {string} description - Module description
 * @param {React.ReactNode} icon - Icon component to display next to title
 * @param {Array} breadcrumbs - Array of {label, href, icon} objects
 * @param {Array} actions - Array of {label, onClick, icon, variant} action buttons
 * @param {React.ReactNode} children - Optional additional content (e.g., tabs)
 */
const ModuleHeader = ({
    title,
    description,
    icon: TitleIcon,
    breadcrumbs = [],
    actions = [],
    children
}) => {
    return (
        <div className="space-y-4">
            {/* Breadcrumb Navigation */}
            <nav className="flex items-center text-sm text-slate-500">
                <Link to="/cmspanel" className="hover:text-blue-600 transition-colors flex items-center gap-1">
                    <Home className="w-4 h-4" />
                    Dashboard
                </Link>
                {breadcrumbs.map((crumb, index) => (
                    <React.Fragment key={index}>
                        <ChevronRight className="w-4 h-4 mx-2 text-slate-300" />
                        {crumb.href ? (
                            <Link to={crumb.href} className="hover:text-blue-600 transition-colors flex items-center gap-1">
                                {crumb.icon && <crumb.icon className="w-4 h-4" />}
                                {crumb.label}
                            </Link>
                        ) : (
                            <span className="flex items-center gap-1 text-slate-700 font-medium">
                                {crumb.icon && <crumb.icon className="w-4 h-4" />}
                                {crumb.label}
                            </span>
                        )}
                    </React.Fragment>
                ))}
            </nav>

            {/* Optional Tabs/Children (rendered between breadcrumb and header) */}
            {children}

            {/* Header with Title, Description, and Actions */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                        {TitleIcon && <TitleIcon className="w-6 h-6 text-blue-600" />}
                        {title}
                    </h1>
                    {description && (
                        <p className="text-slate-500 mt-1">{description}</p>
                    )}
                </div>
                {actions.length > 0 && (
                    <div className="flex items-center gap-2">
                        {actions.map((action, index) => (
                            <Button
                                key={index}
                                variant={action.variant || 'default'}
                                onClick={action.onClick}
                                className={action.className}
                            >
                                {action.icon && <action.icon className="w-4 h-4 mr-2" />}
                                {action.label}
                            </Button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default ModuleHeader;
