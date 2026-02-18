
import { supabase } from '@/lib/customSupabaseClient';
import * as LucideIcons from 'lucide-react';

export const ServicesListBlock = ({
    columns = 3,
    showIcon = true,
    services = []
}) => {
    if (services.length === 0) {
        return (
            <div className="text-center p-8 bg-slate-50 text-slate-500 rounded-lg border border-dashed border-slate-300">
                No services found.
            </div>
        );
    }

    const gridCols = {
        1: 'grid-cols-1',
        2: 'grid-cols-1 md:grid-cols-2',
        3: 'grid-cols-1 md:grid-cols-3',
        4: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4'
    };

    return (
        <div className={`grid ${gridCols[columns] || 'grid-cols-3'} gap-8`}>
            {services.map((service, index) => {
                const IconComponent = showIcon && service.icon
                    ? (LucideIcons[service.icon] || LucideIcons.CheckCircle)
                    : null;

                return (
                    <div key={service.id || index} className="p-6 bg-white rounded-xl shadow-sm border border-slate-100 hover:shadow-md transition-shadow">
                        {showIcon && (
                            <div className="w-12 h-12 bg-blue-50 rounded-lg flex items-center justify-center text-blue-600 mb-4">
                                {IconComponent ? <IconComponent className="w-6 h-6" /> : <Settings className="w-6 h-6" />}
                            </div>
                        )}
                        <h3 className="text-lg font-bold text-slate-900 mb-2">{service.title}</h3>
                        <p className="text-slate-600 text-sm leading-relaxed">{service.description}</p>
                    </div>
                );
            })}
        </div>
    );
};

export const resolveServicesData = async ({ props }) => {
    const { count = 6 } = props;
    try {
        // We need to resolve tenant_id from context or assume public/current session
        // For visual builder preview, we might fetch from the current tenant context

        // This query assumes we have access to 'services' table and RLS allows reading
        const { data, error } = await supabase
            .from('services')
            .select('*')
            .eq('status', 'published')
            .order('display_order', { ascending: true })
            .limit(count);

        if (error) throw error;

        return {
            props: {
                ...props,
                services: data || []
            }
        };
    } catch (err) {
        console.error('Error resolving services data:', err);
        return { props: { ...props, services: [] } };
    }
};

export const ServicesListBlockFields = {
    count: {
        type: 'number',
        label: 'Number of Services',
        min: 1,
        max: 20
    },
    columns: {
        type: 'select',
        label: 'Columns',
        options: [
            { label: '1', value: 1 },
            { label: '2', value: 2 },
            { label: '3', value: 3 },
            { label: '4', value: 4 }
        ]
    },
    showIcon: {
        type: 'radio',
        label: 'Show Icon',
        options: [{ label: 'Yes', value: true }, { label: 'No', value: false }]
    }
};
