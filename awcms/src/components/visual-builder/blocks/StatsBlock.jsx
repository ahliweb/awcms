import { Users, TrendingUp, Award, Zap } from 'lucide-react';
import { ColorPickerField } from '../fields/ColorPickerField';

const icons = {
    users: Users,
    trending: TrendingUp,
    award: Award,
    zap: Zap
};

export const StatsBlock = ({ items = [] }) => {
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {items.map((item, index) => {
                const Icon = icons[item.icon] || Users;
                return (
                    <div key={index} className="text-center p-6 bg-white rounded-xl shadow-sm border border-slate-100">
                        <div className="inline-flex items-center justify-center w-12 h-12 mb-4 rounded-full bg-blue-50 text-blue-600">
                            <Icon className="w-6 h-6" />
                        </div>
                        <h3 className="text-3xl font-bold mb-1" style={{ color: item.valueColor || '#0f172a' }}>{item.value}</h3>
                        <p className="text-sm font-medium uppercase tracking-wide" style={{ color: item.labelColor || '#64748b' }}>{item.label}</p>
                    </div>
                );
            })}
        </div>
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
                    { label: 'Zap', value: 'zap' }
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
