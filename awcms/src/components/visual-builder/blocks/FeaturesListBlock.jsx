import { ImageIcon } from 'lucide-react';
import { PageLinkField } from '../fields/PageLinkField';
import { ImageField } from '../fields/ImageField';

export const FeaturesListBlock = ({
    title,
    subtitle,
    tagline,
    items = [],
    layout = 'grid',
    columns = 3,
    image,
    isReversed
}) => {
    const renderContent = () => {
        return (
            <div className={`grid gap-6 ${columns === 2 ? 'sm:grid-cols-2' :
                columns === 4 ? 'sm:grid-cols-2 lg:grid-cols-4' :
                    'sm:grid-cols-2 lg:grid-cols-3'
                }`}>
                {items.map((item, i) => (
                    <div key={i} className="relative flex flex-col p-6 bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 transition-all hover:shadow-md hover:-translate-y-1">
                        {item.icon && (
                            <div className="flex items-center justify-center w-12 h-12 mb-4 rounded-full bg-primary/10 text-primary">
                                <span className="icon-placeholder text-xl">{item.icon.split(':').pop() || '?'}</span>
                            </div>
                        )}
                        <h3 className="text-xl font-bold mb-2 text-slate-900 dark:text-white">{item.title}</h3>
                        <p className="text-slate-600 dark:text-slate-400 leading-relaxed mb-4 flex-1">{item.description}</p>
                        {item.link && (
                            <div className="mt-auto pt-4 border-t border-slate-100 dark:border-slate-800">
                                <span className="text-sm font-medium text-primary flex items-center gap-1">
                                    Learn more →
                                </span>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        );
    };

    return (
        <section className="py-16 px-4 md:px-6 bg-slate-50 dark:bg-slate-950/50">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                {(title || subtitle || tagline) && (
                    <div className="text-center max-w-3xl mx-auto mb-12">
                        {tagline && (
                            <p className="text-primary font-bold tracking-wide uppercase text-sm mb-2">{tagline}</p>
                        )}
                        {title && (
                            <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-4 text-slate-900 dark:text-white">
                                {title}
                            </h2>
                        )}
                        {subtitle && (
                            <p className="text-xl text-slate-600 dark:text-slate-400 leading-relaxed">
                                {subtitle}
                            </p>
                        )}
                    </div>
                )}

                {/* Body */}
                {layout === 'grid' && renderContent()}

                {layout === 'image-side' && (
                    <div className={`flex flex-col lg:flex-row gap-12 items-center ${isReversed ? 'lg:flex-row-reverse' : ''}`}>
                        <div className="flex-1 w-full lg:w-1/2">
                            {image ? (
                                <img src={image} alt={title} className="rounded-2xl shadow-xl w-full object-cover aspect-video" />
                            ) : (
                                <div className="w-full aspect-video bg-slate-200 rounded-2xl flex items-center justify-center text-slate-400">
                                    <ImageIcon className="w-16 h-16" />
                                </div>
                            )}
                        </div>
                        <div className="flex-1 w-full lg:w-1/2">
                            <div className="grid gap-6 sm:grid-cols-1">
                                {items.map((item, i) => (
                                    <div key={i} className="flex gap-4">
                                        <div className="flex-shrink-0 flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 text-primary">
                                            <span className="icon-placeholder text-lg font-bold">{i + 1}</span>
                                        </div>
                                        <div>
                                            <h3 className="text-xl font-bold mb-1 text-slate-900 dark:text-white">{item.title}</h3>
                                            <p className="text-slate-600 dark:text-slate-400">{item.description}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
};

export const FeaturesListBlockFields = {
    layout: {
        type: 'radio',
        label: 'Layout',
        options: [
            { label: 'Grid', value: 'grid' },
            { label: 'Image Side', value: 'image-side' }
        ]
    },
    isReversed: {
        type: 'radio',
        label: 'Reverse Layout (Image Side only)',
        options: [
            { label: 'No', value: false },
            { label: 'Yes', value: true }
        ]
    },
    columns: {
        type: 'radio',
        label: 'Columns (Grid only)',
        options: [
            { label: '2', value: 2 },
            { label: '3', value: 3 },
            { label: '4', value: 4 }
        ]
    },
    image: { type: 'custom', label: 'Image (for Image Side layout)', render: ImageField },
    tagline: { type: 'text', label: 'Tagline' },
    title: { type: 'text', label: 'Title' },
    subtitle: { type: 'textarea', label: 'Subtitle' },
    items: {
        type: 'array',
        getItemSummary: (item) => item.title || 'Feature Item',
        arrayFields: {
            title: { type: 'text', label: 'Title' },
            description: { type: 'textarea', label: 'Description' },
            icon: { type: 'text', label: 'Icon (e.g. tabler:rocket)' },
            link: { type: 'custom', label: 'Link', render: PageLinkField }
        },
        defaultItemProps: {
            title: 'New Feature',
            description: 'Description of the feature.',
            icon: 'tabler:star'
        }
    }
};
