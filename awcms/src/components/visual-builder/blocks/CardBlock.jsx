/**
 * Card Block Component
 * Content card with image, title, and description
 */

import { ColorPickerField } from '../fields/ColorPickerField';

export const CardBlockFields = {
    title: { type: 'text', label: 'Title' },
    titleColor: { type: 'custom', label: 'Title Color', render: ColorPickerField },
    description: { type: 'textarea', label: 'Description' },
    descriptionColor: { type: 'custom', label: 'Description Color', render: ColorPickerField },
    image: { type: 'text', label: 'Image URL' },
    link: { type: 'text', label: 'Link URL' },
    variant: {
        type: 'select',
        label: 'Style',
        options: [
            { label: 'Default', value: 'default' },
            { label: 'Bordered', value: 'bordered' },
            { label: 'Shadow', value: 'shadow' }
        ]
    }
};

export const CardBlock = ({ title, titleColor, description, descriptionColor, image, link, variant, aspectRatio, hoverEffect }) => {
    const variantClasses = {
        default: 'bg-white',
        bordered: 'bg-white border border-slate-200',
        shadow: 'bg-white shadow-lg',
        glass: 'bg-white/20 backdrop-blur-md border border-white/30 shadow-lg text-white'
    };

    const aspectRatioClasses = {
        video: 'aspect-video',
        standard: 'aspect-[4/3]',
        square: 'aspect-square'
    };

    const hoverEffectClasses = {
        none: '',
        lift: 'hover:-translate-y-2 hover:shadow-xl',
        'scale-image': 'group-hover:scale-105'
    };

    const content = (
        <div className={`rounded-xl overflow-hidden transition-all duration-300 h-full flex flex-col ${variantClasses[variant] || variantClasses.default} ${hoverEffect === 'lift' ? hoverEffectClasses.lift : ''} group`}>
            {image && (
                <div className={`${aspectRatioClasses[aspectRatio] || 'aspect-video'} overflow-hidden bg-slate-100`}>
                    <img
                        src={image}
                        alt={title}
                        className={`w-full h-full object-cover transition-transform duration-500 ${hoverEffect === 'scale-image' ? hoverEffectClasses['scale-image'] : ''}`}
                    />
                </div>
            )}
            <div className="p-6 flex-1 flex flex-col">
                <h3 className="text-xl font-bold mb-3 leading-tight" style={{ color: titleColor || (variant === 'glass' ? '#ffffff' : '#1e293b') }}>{title}</h3>
                <p className="text-base leading-relaxed" style={{ color: descriptionColor || (variant === 'glass' ? 'rgba(255,255,255,0.8)' : '#64748b') }}>{description}</p>
            </div>
        </div>
    );

    if (link) {
        return (
            <a href={link} className="block h-full transition-opacity outline-none focus:ring-2 focus:ring-blue-500 rounded-xl">
                {content}
            </a>
        );
    }

    return content;
};

export default CardBlock;
