import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ColorPickerField } from '../fields/ColorPickerField';

export const PricingBlock = ({ items = [] }) => {
    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
            {items.map((item, index) => (
                <div
                    key={index}
                    className={`relative p-8 rounded-2xl flex flex-col ${item.isPopular ? 'bg-slate-900 text-white shadow-xl ring-2 ring-blue-500 scale-105' : 'bg-white text-slate-900 shadow-lg border border-slate-100'}`}
                >
                    {item.isPopular && (
                        <span className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-blue-500 text-white px-3 py-1 rounded-full text-sm font-medium">
                            Most Popular
                        </span>
                    )}

                    <div className="mb-8">
                        <h3 className={`text-lg font-semibold mb-2`} style={{ color: item.titleColor || (item.isPopular ? '#60a5fa' : '#64748b') }}>{item.title}</h3>
                        <div className="flex items-baseline gap-1">
                            <span className="text-4xl font-bold" style={{ color: item.priceColor || (item.isPopular ? '#ffffff' : '#0f172a') }}>{item.price}</span>
                            <span className={`text-sm ${item.isPopular ? 'text-slate-400' : 'text-slate-500'}`}>{item.period}</span>
                        </div>
                        <p className={`mt-4 text-sm`} style={{ color: item.descriptionColor || (item.isPopular ? '#cbd5e1' : '#475569') }}>{item.description}</p>
                    </div>

                    <ul className="space-y-4 mb-8 flex-1">
                        {item.features?.map((feature, i) => (
                            <li key={i} className="flex items-start gap-3">
                                <Check className={`w-5 h-5 shrink-0 ${item.isPopular ? 'text-blue-400' : 'text-blue-600'}`} />
                                <span className={`text-sm ${item.isPopular ? 'text-slate-300' : 'text-slate-600'}`}>{feature.text}</span>
                            </li>
                        ))}
                    </ul>

                    <Button
                        className={`w-full ${item.isPopular ? 'bg-blue-500 hover:bg-blue-600' : 'bg-slate-900 hover:bg-slate-800 text-white'}`}
                        variant={item.isPopular ? 'default' : 'outline'}
                    >
                        {item.buttonText}
                    </Button>
                </div>
            ))}
        </div>
    );
};

export const PricingBlockFields = {
    items: {
        type: 'array',
        getItemSummary: (item) => item.title || 'Pricing Plan',
        arrayFields: {
            title: { type: 'text', label: 'Plan Title' },
            price: { type: 'text', label: 'Price (e.g. $29)' },
            period: { type: 'text', label: 'Period (e.g. /month)' },
            description: { type: 'textarea', label: 'Description' },
            isPopular: {
                type: 'radio',
                label: 'Is Popular?',
                options: [{ label: 'Yes', value: true }, { label: 'No', value: false }]
            },
            buttonText: { type: 'text', label: 'Button Text' },
            titleColor: { type: 'custom', label: 'Title Color', render: ColorPickerField },
            priceColor: { type: 'custom', label: 'Price Color', render: ColorPickerField },
            descriptionColor: { type: 'custom', label: 'Description Color', render: ColorPickerField },
            features: {
                type: 'array',
                getItemSummary: (item) => item.text || 'Feature',
                arrayFields: {
                    text: { type: 'text', label: 'Feature Text' }
                },
                defaultItemProps: { text: 'New feature' }
            }
        },
        defaultItemProps: {
            title: 'Basic',
            price: '$0',
            period: '/mo',
            description: 'For getting started',
            buttonText: 'Get Started',
            features: [{ text: 'Core features' }, { text: 'Community support' }]
        }
    }
};
