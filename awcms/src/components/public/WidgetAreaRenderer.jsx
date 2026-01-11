
import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useWidgets } from '@/hooks/useWidgets';

export const WidgetAreaRenderer = ({ slug, className }) => {
    const [areaId, setAreaId] = useState(null);
    const [loadingId, setLoadingId] = useState(true);

    useEffect(() => {
        const fetchId = async () => {
            if (!slug) return;
            setLoadingId(true);
            try {
                const { data } = await supabase
                    .from('template_parts')
                    .select('id')
                    .eq('slug', slug)
                    .eq('type', 'widget_area')
                    .maybeSingle();

                if (data) setAreaId(data.id);
            } catch (e) {
                console.error("Error resolving widget area:", e);
            } finally {
                setLoadingId(false);
            }
        };
        fetchId();
    }, [slug]);

    if (loadingId) return <div className="animate-pulse h-20 bg-slate-100 rounded w-full"></div>;
    if (!areaId) return null; // Graceful fallback if not found

    return <ConnectedWidgetsList areaId={areaId} className={className} />;
};

const ConnectedWidgetsList = ({ areaId, className }) => {
    const { widgets, loading } = useWidgets(areaId);

    if (loading) return null; // or skeleton

    if (widgets.length === 0) return null;

    return (
        <div className={`space-y-6 ${className || ''}`}>
            {widgets.map(widget => (
                <PublicWidgetWithWrapper key={widget.id} widget={widget} />
            ))}
        </div>
    );
};

const PublicWidgetWithWrapper = ({ widget }) => {
    return (
        <div className="widget-wrapper bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <WidgetDispatcher type={widget.type} config={widget.config} />
        </div>
    );
};

const WidgetDispatcher = ({ type, config }) => {
    switch (type) {
        case 'core/text':
            return <TextWidget config={config} />;
        // Add more cases here
        default:
            return <div className="text-sm text-red-500">Unknown widget type: {type}</div>;
    }
};

const TextWidget = ({ config }) => {
    if (config.isHtml) {
        return <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: config.content }} />;
    }
    return <div className="prose prose-sm max-w-none">{config.content}</div>;
};

export default WidgetAreaRenderer;
