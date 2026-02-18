import { ChevronDown } from 'lucide-react';
import { ColorPickerField } from '../fields/ColorPickerField';
import { sanitizeHTML } from '@/utils/sanitize';

export const AccordionBlock = ({ items = [] }) => {
    return (
        <section className="max-w-4xl mx-auto space-y-4 px-4">
            {items.map((item, index) => (
                <details key={index} className="group bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 open:ring-2 open:ring-primary/20 overflow-hidden transition-all duration-300 shadow-sm hover:shadow-md">
                    <summary className="flex items-center justify-between p-6 cursor-pointer select-none font-semibold text-lg list-none transition-colors" style={{ color: item.titleColor }}>
                        <span>{item.title}</span>
                        <ChevronDown className="w-6 h-6 text-slate-400 group-open:text-primary transform group-open:rotate-180 transition-transform duration-300" />
                    </summary>
                    <div className="px-6 pb-6 pt-0 leading-relaxed text-slate-600 dark:text-slate-400 animate-in fade-in slide-in-from-top-2 duration-200" style={{ color: item.contentColor }}>
                        <div dangerouslySetInnerHTML={sanitizeHTML(item.content)} />
                    </div>
                </details>
            ))}
        </section>
    );
};

export const AccordionBlockFields = {
    items: {
        type: 'array',
        getItemSummary: (item) => item.title || 'Question',
        arrayFields: {
            title: { type: 'text', label: 'Question' },
            titleColor: { type: 'custom', label: 'Title Color', render: ColorPickerField },
            content: { type: 'textarea', label: 'Answer' },
            contentColor: { type: 'custom', label: 'Content Color', render: ColorPickerField }
        },
        defaultItemProps: {
            title: 'Is this secure?',
            content: 'Yes, we use industry standard encryption...'
        }
    }
};
