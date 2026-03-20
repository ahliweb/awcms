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
                'flex flex-row items-center justify-between border-b border-border/60 pb-3',
                className
            )}
        >
            <div className="flex items-center gap-3">
                {IconComponent || resolvedIcon ? (
                    <span
                        className={cn(
                            'flex h-9 w-9 items-center justify-center rounded-xl border border-border/50 bg-card/70 text-muted-foreground',
                            iconWrapperClassName
                        )}
                    >
                        {resolvedIcon || <IconComponent className={cn('h-4 w-4', iconClassName)} />}
                    </span>
                ) : null}
                <div>
                    {title && (
                        <CardTitle className="text-base font-semibold text-foreground">
                            {title}
                        </CardTitle>
                    )}
                    {subtitle && (
                        <p className="text-xs text-muted-foreground">{subtitle}</p>
                    )}
                </div>
            </div>
            {(badge || actions) && (
                <div className="flex items-center gap-2">
                    {badge ? (
                        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
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
