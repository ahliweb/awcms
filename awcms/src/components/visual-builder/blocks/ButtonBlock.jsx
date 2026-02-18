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

export const ButtonBlock = ({ text, textColor, backgroundColor, link, variant, size, alignment, animation }) => {
    const variantClasses = {
        primary: 'bg-blue-600 hover:bg-blue-700 text-white shadow-md',
        secondary: 'bg-slate-600 hover:bg-slate-700 text-white shadow-sm',
        outline: 'border-2 border-blue-600 text-blue-600 hover:bg-blue-50',
        ghost: 'text-blue-600 hover:bg-blue-50',
        gradient: 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-lg border-0',
        glass: 'bg-white/20 backdrop-blur-md border border-white/30 text-white hover:bg-white/30 shadow-lg'
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

    const animationClasses = {
        none: '',
        scale: 'hover:scale-105 active:scale-95',
        lift: 'hover:-translate-y-1 hover:shadow-xl',
        glow: 'hover:shadow-[0_0_15px_rgba(59,130,246,0.6)]'
    };

    const customStyles = {};
    if (textColor) customStyles.color = textColor;
    if (backgroundColor) {
        customStyles.backgroundColor = backgroundColor;
        customStyles.backgroundImage = 'none'; // Override gradient if custom bg color set
    }

    return (
        <div className={`flex ${alignmentClasses[alignment]} py-4`}>
            <a
                href={link || '#'}
                className={`inline-block font-semibold rounded-full transition-all duration-300 ${variantClasses[variant]} ${sizeClasses[size]} ${animationClasses[animation]}`}
                style={customStyles}
            >
                {text}
            </a>
        </div>
    );
};

export default ButtonBlock;
