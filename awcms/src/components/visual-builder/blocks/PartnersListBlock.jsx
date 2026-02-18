
import { supabase } from '@/lib/customSupabaseClient';

export const PartnersListBlock = ({
    partners = []
}) => {
    if (partners.length === 0) {
        return (
            <div className="text-center p-8 bg-slate-50 text-slate-500 rounded-lg border border-dashed border-slate-300">
                No partners found.
            </div>
        );
    }

    return (
        <div className="flex flex-wrap items-center justify-center gap-8 md:gap-12">
            {partners.map((partner, index) => (
                <div key={partner.id || index} className="group grayscale hover:grayscale-0 opacity-70 hover:opacity-100 transition-all duration-300 transform hover:scale-105">
                    {partner.image ? (
                        <img
                            src={partner.image}
                            alt={partner.name}
                            className="max-h-12 w-auto object-contain"
                        />
                    ) : (
                        <span className="font-bold text-slate-400 text-xl">{partner.name}</span>
                    )}
                </div>
            ))}
        </div>
    );
};

export const resolvePartnersData = async ({ props }) => {
    const { count = 6 } = props;
    try {
        const { data, error } = await supabase
            .from('partners')
            .select('*')
            .eq('status', 'published')
            .order('display_order', { ascending: true })
            .limit(count);

        if (error) throw error;

        return {
            props: {
                ...props,
                partners: data || []
            }
        };
    } catch (err) {
        console.error('Error resolving partners data:', err);
        return { props: { ...props, partners: [] } };
    }
};

export const PartnersListBlockFields = {
    count: {
        type: 'number',
        label: 'Number of Partners',
        min: 1,
        max: 20
    }
};
