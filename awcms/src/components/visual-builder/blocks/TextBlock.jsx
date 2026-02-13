/**
 * Text Block Component
 * Rich text content block with alignment options
 */

import { RichTextField } from '../fields/RichTextField';
import { ColorPickerField } from '../fields/ColorPickerField';

import { sanitizeHTML } from '@/utils/sanitize';

export const TextBlockFields = {
    content: {
        type: 'custom',
        label: 'Content',
        render: RichTextField
    },
    textColor: {
        type: 'custom',
        label: 'Text Color',
        render: ColorPickerField
    },
    alignment: {
        type: 'select',
        label: 'Alignment',
        options: [
            { label: 'Left', value: 'left' },
            { label: 'Center', value: 'center' },
            { label: 'Right', value: 'right' },
            { label: 'Justify', value: 'justify' }
        ]
    }
};

export const TextBlock = ({ content, alignment, textColor }) => {
    // Debug logging
    console.log('TextBlock render:', { content, alignment, textColor });

    return (
        <div
            className={`prose prose-lg max-w-none py-4 text-${alignment}`}
            style={{
                textAlign: alignment,
                color: textColor || 'inherit',
                minHeight: '2rem',
                border: '1px dashed #ccc' // Keep subtle debug border
            }}
            dangerouslySetInnerHTML={sanitizeHTML(content)}
        />
    );
};

export default TextBlock;
