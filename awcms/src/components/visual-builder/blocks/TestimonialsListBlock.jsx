
import { supabase } from '@/lib/customSupabaseClient';
import { Quote } from 'lucide-react';

export const TestimonialsListBlock = ({
    layout = 'grid',
    testimonials = []
}) => {
    if (testimonials.length === 0) {
        return (
            <div className="text-center p-8 bg-slate-50 text-slate-500 rounded-lg border border-dashed border-slate-300">
                No testimonials found.
            </div>
        );
    }

    const renderStars = (rating) => {
        if (!rating) return null;
        return (
            <div className="flex gap-1 mb-3">
                {[1, 2, 3, 4, 5].map((star) => (
                    <svg
                        key={star}
                        className={`w-4 h-4 ${star <= rating ? 'text-yellow-400' : 'text-slate-200'}`}
                        fill="currentColor"
                        viewBox="0 0 20 20"
                    >
                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                ))}
            </div>
        );
    };

    return (
        <div className={`grid ${layout === 'grid' ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3' : 'grid-cols-1'} gap-8`}>
            {testimonials.map((t, index) => (
                <div key={t.id || index} className="bg-white rounded-xl shadow-md p-8 border border-slate-100 flex flex-col relative overflow-hidden">
                    <Quote className="absolute top-4 right-4 w-12 h-12 text-slate-100 -z-0" />

                    <div className="relative z-10 flex-1">
                        {renderStars(t.rating || 5)}
                        <blockquote className="text-slate-700 italic mb-6 leading-relaxed">
                            &quot;{t.quote}&quot;
                        </blockquote>
                    </div>

                    <div className="flex items-center gap-4 relative z-10 pt-4 border-t border-slate-100 mt-auto">
                        {t.image ? (
                            <img src={t.image} alt={t.name} className="w-12 h-12 rounded-full object-cover shadow-sm bg-slate-100" />
                        ) : (
                            <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold shrink-0">
                                {t.name?.charAt(0) || 'A'}
                            </div>
                        )}
                        <div>
                            <h4 className="font-bold text-slate-900 text-sm">{t.name}</h4>
                            <p className="text-xs text-slate-500">{t.title}</p>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
};

export const resolveTestimonialsData = async ({ props }) => {
    const { count = 3 } = props;
    try {
        const { data, error } = await supabase
            .from('testimonials')
            .select('*')
            .eq('status', 'published')
            .order('display_order', { ascending: true })
            .limit(count);

        if (error) throw error;

        return {
            props: {
                ...props,
                testimonials: data || []
            }
        };
    } catch (err) {
        console.error('Error resolving testimonials data:', err);
        return { props: { ...props, testimonials: [] } };
    }
};

export const TestimonialsListBlockFields = {
    count: {
        type: 'number',
        label: 'Number of Testimonials',
        min: 1,
        max: 12
    },
    layout: {
        type: 'radio',
        label: 'Layout',
        options: [
            { label: 'Grid', value: 'grid' },
            { label: 'List', value: 'list' }
        ]
    }
};
