import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';

const PageHeader = ({ title, description, breadcrumbs = [], actions, children, icon: TitleIcon }) => {
    return (
        <div className="col-span-full space-y-4">
            <nav className="flex" aria-label="Breadcrumb">
                <ol className="inline-flex flex-wrap items-center gap-x-1 gap-y-1 text-xs font-semibold text-muted-foreground">
                    <li className="inline-flex items-center">
                        <Link
                            to="/cmspanel"
                            className="inline-flex items-center gap-1 rounded-full border border-slate-900/10 bg-white/80 px-3 py-1 text-muted-foreground transition-colors hover:border-primary/35 hover:text-primary dark:border-white/10 dark:bg-slate-900/70"
                        >
                            <Home className="h-3.5 w-3.5" />
                            Home
                        </Link>
                    </li>
                    {breadcrumbs.map((crumb, index) => (
                        <li key={index} className="inline-flex items-center gap-1">
                            <div className="flex items-center">
                                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/70" />
                                {crumb.href ? (
                                    <Link
                                        to={crumb.href}
                                        className="ml-1 rounded-full border border-transparent px-2.5 py-1 text-muted-foreground transition-colors hover:border-slate-900/10 hover:bg-accent/60 hover:text-foreground dark:hover:border-white/10"
                                    >
                                        {crumb.label}
                                    </Link>
                                ) : (
                                    <span className="ml-1 rounded-full border border-slate-900/10 bg-white/82 px-2.5 py-1 text-foreground dark:border-white/10 dark:bg-slate-900/70">{crumb.label}</span>
                                )}
                            </div>
                        </li>
                    ))}
                </ol>
            </nav>

            <div className="emdash-panel overflow-hidden p-5 sm:p-6">
                <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-[radial-gradient(420px_120px_at_0%_0%,rgba(56,189,248,0.16),transparent_62%),radial-gradient(420px_120px_at_100%_0%,rgba(129,140,248,0.14),transparent_60%)]" />
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-1.5">
                        <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-[-0.03em] text-foreground sm:text-3xl">
                            {TitleIcon && (
                                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-slate-900/10 bg-slate-950 text-white shadow-[0_20px_35px_-25px_rgba(15,23,42,0.9)] dark:border-white/10 dark:bg-primary/16 dark:text-primary">
                                    <TitleIcon className="h-5 w-5" />
                                </span>
                            )}
                            <span className="truncate">{title}</span>
                        </h1>

                        {description && <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>}
                        {children && <div className="pt-1.5">{children}</div>}
                    </div>

                    {actions && (
                        <div className="flex shrink-0 items-center gap-2 rounded-2xl border border-slate-900/10 bg-white/76 p-1.5 shadow-[0_18px_34px_-26px_rgba(15,23,42,0.45)] dark:border-white/10 dark:bg-slate-950/50">
                            {Array.isArray(actions) ? actions : <>{actions}</>}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
export default PageHeader;
