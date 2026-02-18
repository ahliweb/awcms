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

export const HeroBlock = ({ title, titleColor, subtitle, subtitleColor, backgroundImage, buttonText, buttonLink, alignment, overlay, overlayStyle, height, scrollIndicator }) => {
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

    // Overlay Logic
    const activeOverlay = overlayStyle || (overlay ? 'dark' : 'none');

    const getOverlayClass = (style) => {
        switch (style) {
            case 'dark': return 'bg-black/50';
            case 'gradient-bottom': return 'bg-gradient-to-t from-black/80 via-black/20 to-transparent';
            case 'gradient-center': return 'bg-radial-gradient from-black/40 to-black/80'; // Requires custom utility or just use standard approach
            case 'blur': return 'bg-black/30 backdrop-blur-[2px]';
            default: return '';
        }
    };

    // Approximate radial gradient using standard Tailwind if needed, or just partial backgrounds
    const overlayClass = activeOverlay === 'gradient-center'
        ? 'bg-black/40' // Fallback or simpler version
        : getOverlayClass(activeOverlay);

    return (
        <div
            className={`relative flex flex-col justify-center ${heightClasses[height]} ${alignmentClasses[alignment]} px-8 py-16 overflow-hidden`}
            style={{
                backgroundImage: backgroundImage ? `url(${backgroundImage})` : undefined,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                backgroundColor: backgroundImage ? undefined : '#1e293b'
            }}
        >
            {activeOverlay !== 'none' && backgroundImage && (
                <div className={`absolute inset-0 pointer-events-none ${overlayClass}`} />
            )}

            {/* Special handling for gradient-center if needing complex gradient */}
            {activeOverlay === 'gradient-center' && backgroundImage && (
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-black/20 via-black/60 to-black/90 pointer-events-none" />
            )}

            <div className="relative z-10 max-w-4xl mx-auto w-full">
                <h1 className="text-4xl md:text-5xl lg:text-7xl font-bold mb-6 tracking-tight leading-tight"
                    style={{ color: titleColor || '#ffffff', textShadow: '0 2px 10px rgba(0,0,0,0.1)' }}>
                    {title}
                </h1>

                {subtitle && (
                    <p className="text-lg md:text-xl md:text-2xl mb-10 max-w-2xl opacity-90 leading-relaxed"
                        style={{ color: subtitleColor || 'rgba(255,255,255,0.95)' }}>
                        {subtitle}
                    </p>
                )}

                {buttonText && (
                    <a
                        href={buttonLink || '#'}
                        className="inline-flex items-center px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-full transition-all hover:scale-105 active:scale-95 shadow-lg hover:shadow-blue-500/25"
                    >
                        {buttonText}
                    </a>
                )}
            </div>

            {scrollIndicator && (
                <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 animate-bounce z-20">
                    <svg className="w-6 h-6 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                    </svg>
                </div>
            )}
        </div>
    );
};

export default HeroBlock;
