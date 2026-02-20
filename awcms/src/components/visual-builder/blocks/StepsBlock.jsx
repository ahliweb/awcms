import { ImageIcon } from 'lucide-react';
import { PageLinkField } from '../fields/PageLinkField';
import { ImageField } from '../fields/ImageField';

export const StepsBlock = ({
    title,
    subtitle,
    tagline,
    items = [],
    image,
    isReversed,
    callToAction
}) => {
    return (
        <section className="py-16 px-4 md:px-6 bg-white dark:bg-slate-950">
            <div className={`max-w-6xl mx-auto flex flex-col md:gap-12 ${isReversed ? 'md:flex-row-reverse' : 'md:flex-row'}`}>

                {/* Image Section */}
                <div className={`md:w-1/2 ${!image ? 'hidden md:block bg-slate-100 rounded-xl min-h-[400px]' : ''}`}>
                    {image ? (
                        <div className="sticky top-24">
                            <img
                                src={image}
                                alt={title}
                                className="w-full h-auto object-cover rounded-xl shadow-lg aspect-[4/5]"
                            />
                        </div>
                    ) : (
                        <div className="h-full w-full flex items-center justify-center text-slate-400">
                            <ImageIcon className="w-20 h-20" />
                        </div>
                    )}
                </div>

                {/* Content Section */}
                <div className={`md:w-1/2 flex flex-col justify-center ${!image ? 'md:w-full max-w-4xl mx-auto' : ''}`}>
                    {(title || subtitle || tagline) && (
                        <div className="mb-10">
                            {tagline && (
                                <p className="text-primary font-bold tracking-wide uppercase text-sm mb-2">{tagline}</p>
                            )}
                            {title && (
                                <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4 text-slate-900 dark:text-white">
                                    {title}
                                </h2>
                            )}
                            {subtitle && (
                                <p className="text-lg text-slate-600 dark:text-slate-400 leading-relaxed">
                                    {subtitle}
                                </p>
                            )}
                        </div>
                    )}

                </div>
                {items.map((item, i) => (
                    <div key={i} className="flex gap-4 group">
                        <div className="flex flex-col items-center">
                            <div className="flex items-center justify-center w-10 h-10 rounded-full border-2 border-primary text-primary font-bold text-lg bg-white z-10 group-hover:bg-primary group-hover:text-white transition-colors">
                                {i + 1}
                            </div>
                            {i !== items.length - 1 && (
                                <div className="w-0.5 h-full bg-slate-200 dark:bg-slate-800 -my-2" />
                            )}
                        </div>
                        <div className="pb-8">
                            <h3 className="text-xl font-bold mb-2 text-slate-900 dark:text-white group-hover:text-primary transition-colors">
                                {item.title}
                            </h3>
                            <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                                {item.description}
                            </p>
                            {item.icon && (
                                <div className="mt-2 text-xs text-slate-400 font-mono">
                                    Icon: {item.icon}
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {callToAction?.text && callToAction?.link && (
                <div className="mt-12 text-center">
                    <a
                        href={callToAction.link}
                        className="inline-flex items-center justify-center bg-primary text-white px-8 py-3 rounded-full font-bold text-lg shadow-lg hover:bg-primary/90 hover:scale-105 transition-all"
                    >
                        {callToAction.text}
                    </a>
                </div>
            )}
        </section >
    );
};

export const StepsBlockFields = {
    isReversed: {
        type: 'radio',
        label: 'Reverse Layout',
        options: [
            { label: 'No', value: false },
            { label: 'Yes', value: true }
        ]
    },
    image: { type: 'custom', label: 'Image', render: ImageField },
    tagline: { type: 'text', label: 'Tagline' },
    title: { type: 'text', label: 'Title' },
    subtitle: { type: 'textarea', label: 'Subtitle' },
    items: {
        type: 'array',
        getItemSummary: (item) => item.title || 'Step Item',
        arrayFields: {
            title: { type: 'text', label: 'Title' },
            description: { type: 'textarea', label: 'Description' },
            icon: { type: 'text', label: 'Icon (e.g. tabler:package)' }
        },
        defaultItemProps: {
            title: 'New Step',
            description: 'Description of this step.',
            icon: 'tabler:check'
        }
    },
    callToAction: {
        type: 'object',
        objectFields: {
            text: { type: 'text', label: 'Button Text' },
            link: { type: 'custom', label: 'Button Link', render: PageLinkField }
        }
    }
};
