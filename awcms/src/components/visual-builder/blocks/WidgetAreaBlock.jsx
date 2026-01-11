
import React from 'react';
import { WidgetAreaRenderer } from '@/components/public/WidgetAreaRenderer';

// Fields definition for the sidebar editor
export const WidgetAreaBlockFields = {
    areaSlug: {
        type: 'select',
        label: 'Widget Area',
        options: [
            { label: 'Default Sidebar', value: 'default-sidebar' },
            { label: 'Footer Column 1', value: 'footer-col-1' },
            { label: 'Footer Column 2', value: 'footer-col-2' },
        ]
    },
    title: { type: 'text', label: 'Title (Optional)' }
};

export const WidgetAreaBlock = ({ areaSlug, title, puck }) => {
    return (
        <div className="w-full h-full">
            {title && <h3 className="text-lg font-bold mb-4">{title}</h3>}
            {areaSlug ? (
                <WidgetAreaWrapper slug={areaSlug} isEditing={!!puck?.isEditing} />
            ) : (
                <div className="p-4 border border-dashed rounded bg-slate-50 text-slate-400 text-center">
                    Select a Widget Area
                </div>
            )}
        </div>
    );
};

const WidgetAreaWrapper = ({ slug, isEditing }) => {
    return (
        <div className={isEditing ? "min-h-[50px] outline-dashed outline-1 outline-slate-300 p-2" : ""}>
            <WidgetAreaRenderer slug={slug} className="" />
        </div>
    );
};
