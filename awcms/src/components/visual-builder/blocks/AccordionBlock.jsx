import { ChevronDown } from 'lucide-react';
import { ColorPickerField } from '../fields/ColorPickerField';
import { sanitizeHTML } from '@/utils/sanitize';

export const AccordionBlock = ({ items = [] }) => {
    return (
        <div className="max-w-3xl mx-auto space-y-4">
            {items.map((item, index) => (
                <details key={index} className="group bg-white rounded-lg border border-slate-200 open:ring-1 open:ring-blue-100 overflow-hidden">
                    <summary className="flex items-center justify-between p-4 cursor-pointer select-none font-medium list-none group-open:bg-slate-50 transition-colors" style={{ color: item.titleColor || '#0f172a' }}>
                        <span>{item.title}</span>
                        <ChevronDown className="w-5 h-5 text-slate-400 transform group-open:rotate-180 transition-transform" />
                    </summary>
                    <div className="p-4 pt-0 leading-relaxed border-t border-transparent group-open:border-slate-100 bg-slate-50/50" style={{ color: item.contentColor || '#475569' }}>
                        <div className="mt-4" dangerouslySetInnerHTML={sanitizeHTML(item.content)} />
                    </div>
                </details>
            ))}
        </div>
    );
};

export const AccordionBlockFields = {
    items: {
        type: 'array',
        getItemSummary: (item) => item.title || 'Accordion Item',
        arrayFields: {
            title: { type: 'text', label: 'Question / Title' },
            titleColor: { type: 'custom', label: 'Title Color', render: ColorPickerField },
            content: { type: 'textarea', label: 'Answer / Content' },
            contentColor: { type: 'custom', label: 'Content Color', render: ColorPickerField }
        },
        defaultItemProps: {
            title: 'New Question',
            content: 'Enter the answer here...'
        }
    }
};
