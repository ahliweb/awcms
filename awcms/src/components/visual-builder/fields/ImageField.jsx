/**
 * Custom Puck Field Components
 * Custom field renderers for Puck editor that integrate with AWCMS components
 */

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FolderOpen, X, Trash2 } from 'lucide-react';
import MediaLibrary from '@/components/dashboard/media/MediaLibrary';
import { supabase } from '@/lib/customSupabaseClient';

/**
 * Image Field with Media Library integration
 * Custom Puck field for selecting images from Media Library or URL
 */
export const ImageField = ({ field, value, onChange, name }) => {
    const [open, setOpen] = useState(false);
    const [urlInput, setUrlInput] = useState(value || '');

    const handleSelect = (file) => {
        const { data } = supabase.storage
            .from(file.bucket_name || 'cms-uploads')
            .getPublicUrl(file.file_path);

        if (data.publicUrl) {
            onChange(data.publicUrl);
            setUrlInput(data.publicUrl);
            setOpen(false);
        }
    };

    const handleUrlChange = (e) => {
        setUrlInput(e.target.value);
        onChange(e.target.value);
    };

    const handleClear = () => {
        onChange('');
        setUrlInput('');
    };

    return (
        <div className="space-y-3">
            <Label>{field.label || name}</Label>

            {/* Preview */}
            {value && (
                <div className="relative group w-full h-32 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800">
                    <img
                        src={value}
                        alt="Selected"
                        className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <Button
                            variant="destructive"
                            size="sm"
                            onClick={handleClear}
                        >
                            <Trash2 className="w-4 h-4 mr-1" />
                            Remove
                        </Button>
                    </div>
                </div>
            )}

            {/* Controls */}
            <Tabs defaultValue="library" className="w-full">
                <TabsList className="grid w-full grid-cols-2 h-9">
                    <TabsTrigger value="library" className="text-xs">Media Library</TabsTrigger>
                    <TabsTrigger value="url" className="text-xs">External URL</TabsTrigger>
                </TabsList>

                <TabsContent value="library" className="mt-2">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => setOpen(true)}
                    >
                        <FolderOpen className="w-4 h-4 mr-2" />
                        Browse Library
                    </Button>

                    <Dialog open={open} onOpenChange={setOpen}>
                        <DialogContent className="max-w-4xl h-[80vh] flex flex-col p-0 gap-0">
                            <DialogHeader className="px-6 py-4 border-b">
                                <DialogTitle>Select Image</DialogTitle>
                            </DialogHeader>
                            <div className="flex-1 min-h-0 overflow-hidden p-0">
                                <MediaLibrary onSelect={handleSelect} selectionMode="single" />
                            </div>
                        </DialogContent>
                    </Dialog>
                </TabsContent>

                <TabsContent value="url" className="mt-2">
                    <Input
                        value={urlInput}
                        onChange={handleUrlChange}
                        placeholder="https://..."
                        className="h-9 text-sm"
                    />
                </TabsContent>
            </Tabs>
        </div>
    );
};

/**
 * Multi-Image Field for Gallery blocks
 * Allows selecting multiple images from Media Library
 */
export const MultiImageField = ({ field, value, onChange, name }) => {
    const [open, setOpen] = useState(false);

    // Parse current images (newline separated URLs)
    const imageList = value
        ? value.split('\n').filter(url => url.trim().length > 0)
        : [];

    const handleSelect = (file) => {
        const { data } = supabase.storage
            .from(file.bucket_name || 'cms-uploads')
            .getPublicUrl(file.file_path);

        if (data.publicUrl) {
            const newImages = [...imageList, data.publicUrl];
            onChange(newImages.join('\n'));
            setOpen(false);
        }
    };

    const handleRemove = (index) => {
        const newImages = imageList.filter((_, i) => i !== index);
        onChange(newImages.join('\n'));
    };

    const handleAddUrl = () => {
        const url = prompt('Enter image URL:');
        if (url && url.trim()) {
            const newImages = [...imageList, url.trim()];
            onChange(newImages.join('\n'));
        }
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <Label>{field.label || name}</Label>
                <span className="text-xs text-slate-500">{imageList.length} images</span>
            </div>

            {/* Image Grid Preview */}
            {imageList.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                    {imageList.map((url, index) => (
                        <div
                            key={index}
                            className="relative group aspect-square rounded-md overflow-hidden border border-slate-200"
                        >
                            <img
                                src={url}
                                alt={`Item ${index + 1}`}
                                className="w-full h-full object-cover"
                            />
                            <button
                                onClick={() => handleRemove(index)}
                                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-500 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                            >
                                <X className="w-3 h-3" />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* Add Image Buttons */}
            <div className="flex gap-2">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => setOpen(true)}
                >
                    <FolderOpen className="w-4 h-4 mr-2" />
                    Add from Library
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleAddUrl}
                >
                    + URL
                </Button>
            </div>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-w-4xl h-[80vh] flex flex-col p-0 gap-0">
                    <DialogHeader className="px-6 py-4 border-b">
                        <DialogTitle>Add Image to Gallery</DialogTitle>
                    </DialogHeader>
                    <div className="flex-1 min-h-0 overflow-hidden p-0">
                        <MediaLibrary onSelect={handleSelect} selectionMode="single" />
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
};

const ImageFieldFields = {
    ImageField,
    MultiImageField
};

export default ImageFieldFields;
