import React, { useMemo } from 'react';
import { usePlugins } from '@/contexts/PluginContext';
import ExtensionErrorBoundary from '@/components/ui/ExtensionErrorBoundary';
import { cn } from '@/lib/utils';

const getSortValue = (widget) => {
    if (typeof widget?.priority === 'number') return widget.priority;
    if (typeof widget?.order === 'number') return widget.order;
    return 0;
};

const normalizeWidget = (widget, index, getPluginComponent) => {
    if (!widget) return null;

    if (React.isValidElement(widget)) {
        return {
            id: widget.key || `widget-${index}`,
            element: widget,
            position: 'main'
        };
    }

    if (typeof widget === 'function') {
        return {
            id: widget.displayName || widget.name || `widget-${index}`,
            component: widget,
            position: 'main'
        };
    }

    if (typeof widget !== 'object') return null;

    const componentRef = widget.component || widget.element;
    let component = null;
    let element = null;

    if (React.isValidElement(componentRef)) {
        element = componentRef;
    } else if (typeof componentRef === 'string') {
        component = getPluginComponent(componentRef);
    } else if (typeof componentRef === 'function') {
        component = componentRef;
    }

    return {
        ...widget,
        id: widget.id || `widget-${index}`,
        component,
        element,
        position: widget.position || 'main'
    };
};

const PluginWidgets = ({ position = 'main', layout = 'stack', className = '' }) => {
    const { applyFilters, isLoading, getPluginComponent } = usePlugins();

    const widgets = useMemo(() => {
        if (isLoading) return [];
        const filtered = applyFilters('dashboard_widgets', []);
        return Array.isArray(filtered) ? filtered : [];
    }, [applyFilters, isLoading]);

    const renderedWidgets = useMemo(() => {
        const normalized = widgets
            .map((widget, index) => normalizeWidget(widget, index, getPluginComponent))
            .filter(Boolean)
            .filter((widget) => (widget.position || 'main') === position)
            .sort((a, b) => getSortValue(a) - getSortValue(b));

        return normalized.map((widget) => {
            const WidgetComponent = widget.component;
            const sizeClass = widget.size === 'large' ? 'md:col-span-2' : '';
            const frameVariant = widget.frame ?? 'default';
            const frameEnabled = frameVariant !== false && frameVariant !== 'none';
            const frameClassName = frameEnabled
                ? cn(
                    'rounded-2xl border border-slate-200/70 bg-white/80 shadow-sm dark:border-slate-700/70 dark:bg-slate-900/60',
                    frameVariant === 'flush' ? 'overflow-hidden p-0' : 'p-4'
                )
                : '';
            const wrapperClassName = cn(sizeClass, frameClassName, widget.className);

            const content = widget.element
                ? widget.element
                : WidgetComponent
                    ? <WidgetComponent {...(widget.props || {})} widget={widget} />
                    : null;

            if (!content) return null;

            return (
                <div key={widget.id} className={wrapperClassName}>
                    <ExtensionErrorBoundary extensionName={`Widget: ${widget.id}`}>
                        {content}
                    </ExtensionErrorBoundary>
                </div>
            );
        }).filter(Boolean);
    }, [widgets, getPluginComponent, position]);

    if (renderedWidgets.length === 0) return null;

    if (layout === 'grid') {
        return (
            <div className={cn('grid gap-6', className)}>
                {renderedWidgets}
            </div>
        );
    }

    return <>{renderedWidgets}</>;
};

export default PluginWidgets;
