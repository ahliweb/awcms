/**
 * Button Block Component
 * CTA button with styling variants
 */

import { ColorPickerField } from '../fields/ColorPickerField';

export const ButtonBlockFields = {
    text: { type: 'text', label: 'Button Text' },
    textColor: { type: 'custom', label: 'Text Color (overrides variant)', render: ColorPickerField },
    backgroundColor: { type: 'custom', label: 'Background Color (overrides variant)', render: ColorPickerField },
    link: { type: 'text', label: 'Link URL' },
    variant: {
        type: 'select',
        label: 'Style',
        options: [
            { label: 'Primary (Blue)', value: 'primary' },
            { label: 'Secondary (Gray)', value: 'secondary' },
            { label: 'Outline', value: 'outline' },
            { label: 'Ghost', value: 'ghost' }
        ]
    },
    size: {
        type: 'select',
        label: 'Size',
        options: [
            { label: 'Small', value: 'small' },
            { label: 'Medium', value: 'medium' },
            { label: 'Large', value: 'large' }
        ]
    },
    alignment: {
        type: 'select',
        label: 'Alignment',
        options: [
            { label: 'Left', value: 'left' },
            { label: 'Center', value: 'center' },
            { label: 'Right', value: 'right' }
        ]
    }
};

export const ButtonBlock = ({ text, textColor, backgroundColor, link, variant, size, alignment }) => {
    const variantClasses = {
        primary: 'bg-blue-600 hover:bg-blue-700 text-white',
        secondary: 'bg-slate-600 hover:bg-slate-700 text-white',
        outline: 'border-2 border-blue-600 text-blue-600 hover:bg-blue-50',
        ghost: 'text-blue-600 hover:bg-blue-50'
    };

    const sizeClasses = {
        small: 'px-4 py-2 text-sm',
        medium: 'px-6 py-3 text-base',
        large: 'px-8 py-4 text-lg'
    };

    const alignmentClasses = {
        left: 'justify-start',
        center: 'justify-center',
        right: 'justify-end'
    };

    const customStyles = {};
    if (textColor) customStyles.color = textColor;
    if (backgroundColor) customStyles.backgroundColor = backgroundColor;

    return (
        <div className={`flex ${alignmentClasses[alignment]} py-4`}>
            <a
                href={link || '#'}
                className={`inline-block font-medium rounded-lg transition-colors ${variantClasses[variant]} ${sizeClasses[size]}`}
                style={customStyles}
            >
                {text}
            </a>
        </div>
    );
};

export default ButtonBlock;
