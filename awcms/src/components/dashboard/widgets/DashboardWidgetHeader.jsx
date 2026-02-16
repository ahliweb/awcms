import React from 'react';
import { CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const DashboardWidgetHeader = ({
    title,
    subtitle,
    badge,
    icon: Icon,
    actions,
    className,
    iconWrapperClassName,
    iconClassName,
}) => {
    if (!title && !subtitle && !badge && !actions && !Icon) return null;

    const resolvedIcon = Icon && React.isValidElement(Icon) ? Icon : null;
    const IconComponent = !resolvedIcon && typeof Icon === 'function' ? Icon : null;

    return (
        <CardHeader
            className={cn(
                'flex flex-row items-center justify-between border-b border-slate-100/80 pb-3 dark:border-slate-700/60',
                className
            )}
        >
            <div className="flex items-center gap-3">
                {IconComponent || resolvedIcon ? (
                    <span
                        className={cn(
                            'flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-200',
                            iconWrapperClassName
                        )}
                    >
                        {resolvedIcon || <IconComponent className={cn('h-4 w-4', iconClassName)} />}
                    </span>
                ) : null}
                <div>
                    {title && (
                        <CardTitle className="text-base font-semibold text-slate-800 dark:text-slate-100">
                            {title}
                        </CardTitle>
                    )}
                    {subtitle && (
                        <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
                    )}
                </div>
            </div>
            {(badge || actions) && (
                <div className="flex items-center gap-2">
                    {badge ? (
                        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                            {badge}
                        </span>
                    ) : null}
                    {actions}
                </div>
            )}
        </CardHeader>
    );
};

export default DashboardWidgetHeader;
