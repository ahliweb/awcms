import { Users, TrendingUp, Award, Zap, BarChart, Activity, Globe, Shield } from 'lucide-react';
import { ColorPickerField } from '../fields/ColorPickerField';

const icons = {
    users: Users,
    trending: TrendingUp,
    award: Award,
    zap: Zap,
    chart: BarChart,
    activity: Activity,
    globe: Globe,
    shield: Shield
};

export const StatsBlock = ({ items = [] }) => {
    return (
        <section className="py-12 md:py-20 bg-white dark:bg-slate-950 border-y border-slate-100 dark:border-slate-900">
            <div className="max-w-7xl mx-auto px-4 md:px-6">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 md:gap-12">
                    {items.map((item, index) => {
                        const Icon = icons[item.icon] || Users;
                        return (
                            <div key={index} className="flex flex-col items-center text-center group">
                                <div className="inline-flex items-center justify-center w-16 h-16 mb-6 rounded-2xl bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 transform transition-transform group-hover:scale-110 group-hover:-rotate-3 duration-300">
                                    <Icon className="w-8 h-8" strokeWidth={1.5} />
                                </div>
                                <h3 className="text-4xl md:text-5xl font-extrabold mb-2 tracking-tight" style={{ color: item.valueColor }}>{item.value}</h3>
                                <p className="text-sm font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400" style={{ color: item.labelColor }}>{item.label}</p>
                            </div>
                        );
                    })}
                </div>
            </div>
        </section>
    );
};

export const StatsBlockFields = {
    items: {
        type: 'array',
        getItemSummary: (item) => item.label || 'Stat Item',
        arrayFields: {
            value: { type: 'text', label: 'Value (e.g. 10k+)' },
            label: { type: 'text', label: 'Label' },
            icon: {
                type: 'select',
                label: 'Icon',
                options: [
                    { label: 'Users', value: 'users' },
                    { label: 'Trending', value: 'trending' },
                    { label: 'Award', value: 'award' },
                    { label: 'Zap', value: 'zap' },
                    { label: 'Chart', value: 'chart' },
                    { label: 'Activity', value: 'activity' },
                    { label: 'Globe', value: 'globe' },
                    { label: 'Shield', value: 'shield' }
                ]
            },
            valueColor: { type: 'custom', label: 'Value Color', render: ColorPickerField },
            labelColor: { type: 'custom', label: 'Label Color', render: ColorPickerField }
        },
        defaultItemProps: {
            value: '100+',
            label: 'Happy Clients',
            icon: 'users'
        }
    }
};
