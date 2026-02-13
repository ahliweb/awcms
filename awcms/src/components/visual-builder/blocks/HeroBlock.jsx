/**
 * Hero Block Component
 * Full-width hero section with background image, title, and CTA
 */

import { ColorPickerField } from '../fields/ColorPickerField';

export const HeroBlockFields = {
    title: { type: 'text', label: 'Title' },
    titleColor: { type: 'custom', label: 'Title Color', render: ColorPickerField },
    subtitle: { type: 'textarea', label: 'Subtitle' },
    subtitleColor: { type: 'custom', label: 'Subtitle Color', render: ColorPickerField },
    backgroundImage: { type: 'text', label: 'Background Image URL' },
    buttonText: { type: 'text', label: 'Button Text' },
    buttonLink: { type: 'text', label: 'Button Link' },
    alignment: {
        type: 'select',
        label: 'Text Alignment',
        options: [
            { label: 'Left', value: 'left' },
            { label: 'Center', value: 'center' },
            { label: 'Right', value: 'right' }
        ]
    },
    overlay: {
        type: 'radio', label: 'Dark Overlay', options: [
            { label: 'Yes', value: true },
            { label: 'No', value: false }
        ]
    },
    height: {
        type: 'select',
        label: 'Height',
        options: [
            { label: 'Small (300px)', value: 'small' },
            { label: 'Medium (450px)', value: 'medium' },
            { label: 'Large (600px)', value: 'large' },
            { label: 'Full Screen', value: 'full' }
        ]
    }
};

export const HeroBlock = ({ title, titleColor, subtitle, subtitleColor, backgroundImage, buttonText, buttonLink, alignment, overlay, height }) => {
    const heightClasses = {
        small: 'min-h-[300px]',
        medium: 'min-h-[450px]',
        large: 'min-h-[600px]',
        full: 'min-h-screen'
    };

    const alignmentClasses = {
        left: 'text-left items-start',
        center: 'text-center items-center',
        right: 'text-right items-end'
    };

    return (
        <div
            className={`relative flex flex-col justify-center ${heightClasses[height]} ${alignmentClasses[alignment]} px-8 py-16`}
            style={{
                backgroundImage: backgroundImage ? `url(${backgroundImage})` : undefined,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                backgroundColor: backgroundImage ? undefined : '#1e293b'
            }}
        >
            {overlay && backgroundImage && (
                <div className="absolute inset-0 bg-black/50" />
            )}

            <div className="relative z-10 max-w-4xl mx-auto">
                <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-4" style={{ color: titleColor || '#ffffff' }}>
                    {title}
                </h1>

                {subtitle && (
                    <p className="text-lg md:text-xl mb-8 max-w-2xl" style={{ color: subtitleColor || 'rgba(255,255,255,0.9)' }}>
                        {subtitle}
                    </p>
                )}

                {buttonText && (
                    <a
                        href={buttonLink || '#'}
                        className="inline-block px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
                    >
                        {buttonText}
                    </a>
                )}
            </div>
        </div>
    );
};

export default HeroBlock;
