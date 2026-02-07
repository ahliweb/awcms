import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';

const PageHeader = ({ title, description, breadcrumbs = [], actions, children }) => {
    return (
        <div className="col-span-full space-y-4">
            <nav className="flex" aria-label="Breadcrumb">
                <ol className="inline-flex items-center space-x-1 text-xs font-semibold text-slate-500 dark:text-slate-400 md:space-x-2">
                    <li className="inline-flex items-center">
                        <Link to="/cmspanel" className="inline-flex items-center text-slate-600 hover:text-primary-600 dark:text-slate-300 dark:hover:text-white">
                            <Home className="w-4 h-4 mr-2" />
                            Home
                        </Link>
                    </li>
                    {breadcrumbs.map((crumb, index) => (
                        <li key={index}>
                            <div className="flex items-center">
                                <ChevronRight className="w-4 h-4 text-slate-400" />
                                {crumb.href ? (
                                    <Link to={crumb.href} className="ml-1 text-slate-600 hover:text-primary-600 md:ml-2 dark:text-slate-300 dark:hover:text-white">
                                        {crumb.label}
                                    </Link>
                                ) : (
                                    <span className="ml-1 text-slate-400 md:ml-2 dark:text-slate-500">{crumb.label}</span>
                                )}
                            </div>
                        </li>
                    ))}
                </ol>
            </nav>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div className="space-y-1">
                    <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white sm:text-3xl">{title}</h1>
                    {description && <p className="text-sm text-slate-500 dark:text-slate-400">{description}</p>}
                    {children && <div className="pt-2">{children}</div>}
                </div>
                {actions && (
                    <div className="flex items-center gap-2">
                        {actions}
                    </div>
                )}
            </div>
        </div>
    );
};
export default PageHeader;
