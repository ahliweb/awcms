/**
 * Image Block Component
 * Image with caption and styling options
 */

export const ImageBlock = ({ src, alt, caption, width, borderRadius }) => {
    const widthClasses = {
        full: 'w-full',
        large: 'w-3/4',
        medium: 'w-1/2',
        small: 'w-1/4'
    };

    const radiusClasses = {
        none: 'rounded-none',
        sm: 'rounded-sm',
        md: 'rounded-md',
        lg: 'rounded-lg',
        full: 'rounded-full'
    };

    if (!src) {
        return (
            <div className="flex items-center justify-center h-48 bg-slate-100 rounded-lg border-2 border-dashed border-slate-300">
                <p className="text-slate-400">No image selected</p>
            </div>
        );
    }

    return (
        <figure className={`${widthClasses[width]} mx-auto py-4`}>
            <img
                src={src}
                alt={alt || ''}
                className={`w-full h-auto ${radiusClasses[borderRadius]}`}
                loading="lazy"
            />
            {caption && (
                <figcaption className="text-sm text-slate-500 text-center mt-2">
                    {caption}
                </figcaption>
            )}
        </figure>
    );
};
