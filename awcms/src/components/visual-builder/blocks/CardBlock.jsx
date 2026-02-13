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

export const CardBlock = ({ title, titleColor, description, descriptionColor, image, link, variant }) => {
    const variantClasses = {
        default: 'bg-white',
        bordered: 'bg-white border border-slate-200',
        shadow: 'bg-white shadow-lg'
    };

    const content = (
        <div className={`rounded-xl overflow-hidden ${variantClasses[variant]}`}>
            {image && (
                <div className="aspect-video overflow-hidden">
                    <img
                        src={image}
                        alt={title}
                        className="w-full h-full object-cover"
                    />
                </div>
            )}
            <div className="p-6">
                <h3 className="text-xl font-bold mb-2" style={{ color: titleColor || '#1e293b' }}>{title}</h3>
                <p style={{ color: descriptionColor || '#64748b' }}>{description}</p>
            </div>
        </div>
    );

    if (link) {
        return (
            <a href={link} className="block hover:opacity-90 transition-opacity">
                {content}
            </a>
        );
    }

    return content;
};

export default CardBlock;
