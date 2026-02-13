import { ColorPickerField } from '../fields/ColorPickerField';

export const DividerBlock = ({
    color = '#e2e8f0',
    height = '1px',
    width = '100%',
    alignment = 'center',
    style = 'solid',
    marginTop = '24px',
    marginBottom = '24px'
}) => {
    const wrapperStyle = {
        display: 'flex',
        justifyContent: alignment === 'left' ? 'flex-start' : alignment === 'right' ? 'flex-end' : 'center',
        paddingTop: marginTop,
        paddingBottom: marginBottom
    };

    const lineStyle = {
        width,
        height: 0,
        borderTopWidth: height,
        borderTopStyle: style,
        borderTopColor: color
    };

    return (
        <div style={wrapperStyle}>
            <div style={lineStyle} />
        </div>
    );
};

export const DividerBlockFields = {
    color: { type: 'custom', label: 'Color', render: ColorPickerField },
    height: {
        type: 'select',
        label: 'Thickness',
        options: [
            { label: 'Thin (1px)', value: '1px' },
            { label: 'Medium (2px)', value: '2px' },
            { label: 'Thick (4px)', value: '4px' }
        ]
    },
    width: {
        type: 'select',
        label: 'Width',
        options: [
            { label: 'Full (100%)', value: '100%' },
            { label: 'Large (75%)', value: '75%' },
            { label: 'Medium (50%)', value: '50%' },
            { label: 'Small (25%)', value: '25%' }
        ]
    },
    alignment: {
        type: 'radio',
        label: 'Alignment',
        options: [
            { label: 'Left', value: 'left' },
            { label: 'Center', value: 'center' },
            { label: 'Right', value: 'right' }
        ]
    },
    style: {
        type: 'select',
        label: 'Style',
        options: [
            { label: 'Solid', value: 'solid' },
            { label: 'Dashed', value: 'dashed' },
            { label: 'Dotted', value: 'dotted' }
        ]
    },
    marginTop: {
        type: 'select',
        label: 'Margin Top',
        options: [
            { label: 'None', value: '0px' },
            { label: 'Small', value: '16px' },
            { label: 'Medium', value: '24px' },
            { label: 'Large', value: '48px' }
        ]
    },
    marginBottom: {
        type: 'select',
        label: 'Margin Bottom',
        options: [
            { label: 'None', value: '0px' },
            { label: 'Small', value: '16px' },
            { label: 'Medium', value: '24px' },
            { label: 'Large', value: '48px' }
        ]
    }
};
