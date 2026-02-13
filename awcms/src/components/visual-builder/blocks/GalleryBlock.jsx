/**
 * Gallery Block Component
 * Image gallery with grid layout options
 */

import { useState } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';

export const GalleryBlockFields = {
    images: {
        type: 'textarea',
        label: 'Image URLs (one per line)',
        description: 'Enter one image URL per line'
    },
    columns: {
        type: 'select',
        label: 'Columns',
        options: [
            { label: '2 Columns', value: 2 },
            { label: '3 Columns', value: 3 },
            { label: '4 Columns', value: 4 },
            { label: '5 Columns', value: 5 }
        ]
    },
    gap: {
        type: 'select',
        label: 'Gap',
        options: [
            { label: 'None', value: 0 },
            { label: 'Small', value: 8 },
            { label: 'Medium', value: 16 },
            { label: 'Large', value: 24 }
        ]
    },
    aspectRatio: {
        type: 'select',
        label: 'Aspect Ratio',
        options: [
            { label: 'Square (1:1)', value: 'square' },
            { label: 'Landscape (16:9)', value: 'landscape' },
            { label: 'Portrait (3:4)', value: 'portrait' },
            { label: 'Auto', value: 'auto' }
        ]
    },
    lightbox: {
        type: 'radio',
        label: 'Enable Lightbox',
        options: [
            { label: 'Yes', value: true },
            { label: 'No', value: false }
        ]
    },
    borderRadius: {
        type: 'select',
        label: 'Border Radius',
        options: [
            { label: 'None', value: 'none' },
            { label: 'Small', value: 'sm' },
            { label: 'Medium', value: 'md' },
            { label: 'Large', value: 'lg' }
        ]
    }
};

export const GalleryBlock = ({ images, columns, gap, aspectRatio, lightbox, borderRadius }) => {
    const [lightboxOpen, setLightboxOpen] = useState(false);
    const [currentIndex, setCurrentIndex] = useState(0);

    // Parse images from textarea (one URL per line)
    const imageList = images
        ? images.split('\n').map(url => url.trim()).filter(url => url.length > 0)
        : [];

    const aspectRatioClasses = {
        square: 'aspect-square',
        landscape: 'aspect-video',
        portrait: 'aspect-[3/4]',
        auto: ''
    };

    const radiusClasses = {
        none: 'rounded-none',
        sm: 'rounded-sm',
        md: 'rounded-md',
        lg: 'rounded-lg'
    };

    const columnClasses = {
        2: 'grid-cols-2',
        3: 'grid-cols-2 md:grid-cols-3',
        4: 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4',
        5: 'grid-cols-2 md:grid-cols-3 lg:grid-cols-5'
    };

    const handleImageClick = (index) => {
        if (lightbox) {
            setCurrentIndex(index);
            setLightboxOpen(true);
        }
    };

    const handlePrev = () => {
        setCurrentIndex((prev) => (prev === 0 ? imageList.length - 1 : prev - 1));
    };

    const handleNext = () => {
        setCurrentIndex((prev) => (prev === imageList.length - 1 ? 0 : prev + 1));
    };

    if (imageList.length === 0) {
        return (
            <div className="flex items-center justify-center h-48 bg-slate-100 rounded-lg border-2 border-dashed border-slate-300">
                <p className="text-slate-400">No images added. Enter image URLs in the settings.</p>
            </div>
        );
    }

    return (
        <>
            <div
                className={`grid ${columnClasses[columns]} py-4`}
                style={{ gap: `${gap}px` }}
            >
                {imageList.map((src, index) => (
                    <div
                        key={index}
                        className={`${aspectRatioClasses[aspectRatio]} overflow-hidden ${radiusClasses[borderRadius]} ${lightbox ? 'cursor-pointer hover:opacity-90 transition-opacity' : ''}`}
                        onClick={() => handleImageClick(index)}
                    >
                        <img
                            src={src}
                            alt={`Slide ${index + 1}`}
                            className="w-full h-full object-cover"
                        />
                    </div>
                ))}
            </div>

            {/* Lightbox */}
            {lightbox && lightboxOpen && (
                <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4">
                    <button
                        onClick={() => setLightboxOpen(false)}
                        className="absolute top-4 right-4 text-white hover:text-slate-300 transition-colors"
                    >
                        <X className="w-8 h-8" />
                    </button>

                    <button
                        onClick={handlePrev}
                        className="absolute left-4 text-white hover:text-slate-300 transition-colors"
                    >
                        <ChevronLeft className="w-10 h-10" />
                    </button>

                    <img
                        src={imageList[currentIndex]}
                        alt={`Slide ${currentIndex + 1}`}
                        className="max-w-full max-h-[80vh] object-contain"
                    />

                    <button
                        onClick={handleNext}
                        className="absolute right-4 text-white hover:text-slate-300 transition-colors"
                    >
                        <ChevronRight className="w-10 h-10" />
                    </button>

                    <div className="absolute bottom-4 text-white text-sm">
                        {currentIndex + 1} / {imageList.length}
                    </div>
                </div>
            )}
        </>
    );
};

export default GalleryBlock;
