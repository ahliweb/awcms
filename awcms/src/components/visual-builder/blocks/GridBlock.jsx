/**
 * Grid Block Component
 * Multi-column layout container
 */

import { DropZone } from '@puckeditor/core';

export const GridBlockFields = {
    columns: {
        type: 'select',
        label: 'Columns',
        options: [
            { label: '2 Columns', value: 2 },
            { label: '3 Columns', value: 3 },
            { label: '4 Columns', value: 4 }
        ]
    },
    gap: {
        type: 'select',
        label: 'Gap',
        options: [
            { label: 'None', value: 0 },
            { label: 'Small (16px)', value: 16 },
            { label: 'Medium (24px)', value: 24 },
            { label: 'Large (32px)', value: 32 }
        ]
    }
};

// Fix syntax error and ensure proper export
export const GridBlock = ({ columns = 2, gap = 0, padding = 0, id }) => {
    if (!id) return null;

    return (
        <div
            className="grid w-full"
            style={{
                gridTemplateColumns: `repeat(${columns}, 1fr)`,
                paddingTop: padding + 'px',
                paddingBottom: padding + 'px',
                gap: gap + 'px'
            }}
        >
            {Array.from({ length: columns }).map((_, index) => (
                <div key={`${id}-col-${index}`} className="min-h-[50px] border border-dashed border-gray-200 rounded p-2">
                    <DropZone zone={`column-${index}`} />
                </div>
            ))}
        </div>
    );
};

export default GridBlock;
