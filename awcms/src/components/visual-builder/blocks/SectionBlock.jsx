import { DropZone } from '@puckeditor/core';
import { ImageField } from '../fields/ImageField';
import { ColorPickerField } from '../fields/ColorPickerField';

export const SectionBlock = ({
    _children,
    _id, // Add _id prop
    backgroundColor = '#ffffff',
    backgroundImage,
    paddingTop = '64px',
    paddingBottom = '64px',
    containerWidth = '1200px',
    textColor = 'inherit'
}) => {
    const style = {
        backgroundColor,
        backgroundImage: backgroundImage ? `url(${backgroundImage})` : 'none',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        paddingTop,
        paddingBottom,
        color: textColor
    };

    const containerStyle = {
        maxWidth: containerWidth === 'full' ? '100%' : containerWidth,
        margin: '0 auto',
        padding: '0 16px'
    };

    // Simplified Zone ID - Let Puck handle the namespacing
    // Puck v0.20+ automatically prefixes zones with the component ID
    const zoneName = 'content';

    return (
        <section style={style} className="relative group">
            {backgroundImage && (
                <div className="absolute inset-0 bg-black/10 pointer-events-none" />
            )}
            <div
                style={{
                    ...containerStyle,
                    minHeight: '100px', // Ensure there's always height
                }}
                className="p-4"
            >
                <div style={{ height: '100%', width: '100%' }}>
                    <DropZone zone={zoneName} />
                </div>
            </div>
        </section>
    );
};

export const SectionBlockFields = {
    backgroundColor: { type: 'custom', label: 'Background Color', render: ColorPickerField },
    textColor: { type: 'custom', label: 'Text Color', render: ColorPickerField },
    backgroundImage: {
        type: 'custom',
        label: 'Background Image',
        render: ImageField
    },
    paddingTop: {
        type: 'select',
        label: 'Top Padding',
        options: [
            { label: 'None (0px)', value: '0px' },
            { label: 'Small (32px)', value: '32px' },
            { label: 'Medium (64px)', value: '64px' },
            { label: 'Large (96px)', value: '96px' },
            { label: 'Huge (128px)', value: '128px' }
        ]
    },
    paddingBottom: {
        type: 'select',
        label: 'Bottom Padding',
        options: [
            { label: 'None (0px)', value: '0px' },
            { label: 'Small (32px)', value: '32px' },
            { label: 'Medium (64px)', value: '64px' },
            { label: 'Large (96px)', value: '96px' },
            { label: 'Huge (128px)', value: '128px' }
        ]
    },
    containerWidth: {
        type: 'select',
        label: 'Width',
        options: [
            { label: 'Boxed (1200px)', value: '1200px' },
            { label: 'Narrow (800px)', value: '800px' },
            { label: 'Full Width', value: 'full' }
        ]
    }
};
