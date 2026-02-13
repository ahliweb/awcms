
import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Dialog, DialogContent, DialogTrigger, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import MediaLibrary from '@/components/dashboard/media/MediaLibrary';
import { supabase } from '@/lib/customSupabaseClient';

// Multi-image upload component for galleries/portfolios
export function MultiImageUpload({ value = [], onChange, disabled, maxImages = 10 }) {
    const [open, setOpen] = useState(false);

    // Ensure value is always an array of objects with url property
    const images = Array.isArray(value) ? value : [];

    const handleSelect = (file) => {
        const { data } = supabase.storage.from(file.bucket_name || 'cms-uploads').getPublicUrl(file.file_path);
        if (data.publicUrl && images.length < maxImages) {
            const newImages = [...images, { url: data.publicUrl, alt: file.name || '' }];
            onChange(newImages);
            setOpen(false);
        }
    };

    const removeImage = (index) => {
        const newImages = images.filter((_, i) => i !== index);
        onChange(newImages);
    };

    const moveImage = (fromIndex, toIndex) => {
        if (toIndex < 0 || toIndex >= images.length) return;
        const newImages = [...images];
        const [movedItem] = newImages.splice(fromIndex, 1);
        newImages.splice(toIndex, 0, movedItem);
        onChange(newImages);
    };

    return (
        <div className="space-y-4">
            {/* Image Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {images.map((img, idx) => (
                    <div
                        key={idx}
                        className="group relative aspect-square bg-slate-100 rounded-lg border border-slate-200 overflow-hidden"
                    >
                        <img
                            src={img.url || img}
                            alt={img.alt || `Image ${idx + 1}`}
                            className="w-full h-full object-cover"
                        />

                        {/* Always visible delete button in corner */}
                        {!disabled && (
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    removeImage(idx);
                                }}
                                className="absolute top-2 right-2 z-10 h-6 w-6 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center shadow-lg transition-all hover:scale-110"
                                title="Remove image"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        )}

                        {/* Hover overlay with move controls */}
                        {!disabled && images.length > 1 && (
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); moveImage(idx, idx - 1); }}
                                    disabled={idx === 0}
                                    className="h-8 w-8 rounded-full bg-white/90 hover:bg-white text-slate-700 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                                >
                                    ←
                                </button>
                                <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); moveImage(idx, idx + 1); }}
                                    disabled={idx === images.length - 1}
                                    className="h-8 w-8 rounded-full bg-white/90 hover:bg-white text-slate-700 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                                >
                                    →
                                </button>
                            </div>
                        )}

                        {/* Index Badge */}
                        <div className="absolute bottom-2 left-2 bg-black/70 text-white text-xs px-2 py-0.5 rounded font-medium">
                            {idx + 1}
                        </div>
                    </div>
                ))}

                {/* Add Button */}
                {images.length < maxImages && !disabled && (
                    <Dialog open={open} onOpenChange={setOpen}>
                        <DialogTrigger asChild>
                            <button
                                type="button"
                                className="aspect-square bg-slate-50 border-2 border-dashed border-slate-300 rounded-lg flex flex-col items-center justify-center gap-2 hover:border-blue-400 hover:bg-blue-50 transition-colors cursor-pointer"
                            >
                                <Plus className="w-8 h-8 text-slate-400" />
                                <span className="text-xs text-slate-500">Add Image</span>
                            </button>
                        </DialogTrigger>
                        <DialogContent className="max-w-4xl h-[80vh] flex flex-col p-0 gap-0">
                            <DialogHeader className="px-6 py-4 border-b">
                                <DialogTitle>Select Image from Library</DialogTitle>
                            </DialogHeader>
                            <div className="flex-1 min-h-0 overflow-hidden p-0">
                                <MediaLibrary onSelect={handleSelect} selectionMode="single" />
                            </div>
                        </DialogContent>
                    </Dialog>
                )}
            </div>

            {/* Info */}
            <p className="text-xs text-slate-500">
                {images.length} / {maxImages} images added. Drag to reorder, hover to remove.
            </p>
        </div>
    );
}
