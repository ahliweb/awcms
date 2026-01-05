import React from 'react';
import { Button } from '@/components/ui/button';
import { Inbox } from 'lucide-react';

/**
 * EmptyState - Standardized empty state component.
 * Displays when no data is available in a list or table.
 * 
 * @param {React.ComponentType} icon - Icon to display
 * @param {string} title - Empty state title
 * @param {string} description - Empty state description
 * @param {object} action - Optional CTA {label, onClick, icon}
 */
const EmptyState = ({
    icon: Icon = Inbox,
    title = 'No data found',
    description = 'There are no items to display.',
    action,
}) => {
    return (
        <div
            className="flex flex-col items-center justify-center min-h-[300px] bg-card rounded-xl border border-border p-12 text-center"
            role="status"
            aria-live="polite"
        >
            <div className="p-4 bg-slate-100 rounded-full mb-4">
                <Icon className="w-12 h-12 text-slate-400" aria-hidden="true" />
            </div>
            <h3 className="text-xl font-bold text-foreground">{title}</h3>
            <p className="text-muted-foreground mt-2 max-w-md">{description}</p>

            {action && (
                <Button
                    onClick={action.onClick}
                    className="mt-6"
                    variant={action.variant || 'default'}
                >
                    {action.icon && <action.icon className="w-4 h-4 mr-2" aria-hidden="true" />}
                    {action.label}
                </Button>
            )}
        </div>
    );
};

export default EmptyState;
