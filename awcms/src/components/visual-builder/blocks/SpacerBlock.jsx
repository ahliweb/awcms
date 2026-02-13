/**
 * Spacer Block Component
 * Adds vertical space between components
 */


export const SpacerBlockFields = {
    height: {
        type: 'number',
        label: 'Height (px)',
        min: 0,
        max: 300
    }
};

export const SpacerBlock = ({ height }) => {
    return (
        <div style={{ height: `${height}px` }} className="w-full" />
    );
};

export default SpacerBlock;
