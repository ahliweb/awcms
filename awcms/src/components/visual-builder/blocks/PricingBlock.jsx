import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ColorPickerField } from '../fields/ColorPickerField';
import { PageLinkField } from '../fields/PageLinkField';
import { Link } from 'react-router-dom';

export const PricingBlock = ({ items = [] }) => {
    return (
        <section className="py-16 px-4 md:px-6 bg-slate-50 dark:bg-slate-950">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-7xl mx-auto items-center">
                {items.map((item, index) => (
                    <div
                        key={index}
                        className={`relative p-8 rounded-3xl flex flex-col transition-all duration-300 ${item.isPopular
                                ? 'bg-slate-900 text-white shadow-2xl ring-4 ring-primary/20 scale-105 z-10'
                                : 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xl hover:shadow-2xl border border-slate-100 dark:border-slate-800'
                            }`}
                    >
                        {item.isPopular && (
                            <span className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-4 py-1.5 rounded-full text-sm font-bold shadow-lg uppercase tracking-wide">
                                {item.ribbonTitle || 'Most Popular'}
                            </span>
                        )}

                        <div className="mb-8">
                            <h3 className={`text-xl font-bold mb-2`} style={{ color: item.titleColor }}>{item.title}</h3>
                            <p className={`text-sm mb-6`} style={{ color: item.descriptionColor || (item.isPopular ? '#cbd5e1' : '#64748b') }}>{item.description}</p>

                            <div className="flex items-baseline gap-1">
                                <span className="text-5xl font-extrabold tracking-tight" style={{ color: item.priceColor }}>{item.price}</span>
                                <span className={`text-sm font-medium ${item.isPopular ? 'text-slate-400' : 'text-slate-500'}`}>{item.period}</span>
                            </div>
                        </div>

                        <div className="h-px w-full bg-gradient-to-r from-transparent via-slate-200 dark:via-slate-700 to-transparent mb-8" />

                        <ul className="space-y-4 mb-8 flex-1">
                            {item.features?.map((feature, i) => (
                                <li key={i} className="flex items-start gap-3">
                                    <div className={`mt-0.5 rounded-full p-1 ${item.isPopular ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'}`}>
                                        <Check className="w-3.5 h-3.5 shrink-0" strokeWidth={3} />
                                    </div>
                                    <span className={`text-sm font-medium ${item.isPopular ? 'text-slate-300' : 'text-slate-600 dark:text-slate-300'}`}>
                                        {feature.text}
                                    </span>
                                </li>
                            ))}
                        </ul>

                        {item.callToAction && (
                            <Button
                                asChild
                                className={`w-full py-6 text-lg shadow-lg transition-all hover:scale-[1.02] active:scale-[0.98] ${item.isPopular
                                        ? 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white border-0'
                                        : 'bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 hover:border-primary hover:text-primary dark:hover:border-primary text-slate-900 dark:text-white'
                                    }`}
                                variant={item.isPopular ? 'default' : 'outline'}
                            >
                                <Link to={item.callToAction}>{item.buttonText}</Link>
                            </Button>
                        )}
                    </div>
                ))}
            </div>
        </section>
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
            ribbonTitle: { type: 'text', label: 'Ribbon Title (if Popular)' },
            buttonText: { type: 'text', label: 'Button Text' },
            callToAction: { type: 'custom', label: 'Button Link', render: PageLinkField },
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
            isPopular: false,
            ribbonTitle: 'Most Popular',
            features: [{ text: 'Core features' }, { text: 'Community support' }]
        }
    }
};
