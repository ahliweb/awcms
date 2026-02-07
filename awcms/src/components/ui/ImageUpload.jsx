
import React, { useEffect, useState } from 'react';
import { X, Image as ImageIcon, FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogTrigger, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import MediaLibrary from '@/components/dashboard/media/MediaLibrary';
import { supabase } from '@/lib/customSupabaseClient';

// Enhanced ImageUpload that includes FilePicker
const normalizeValue = (value) => {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed || trimmed === 'null' || trimmed === 'undefined') return '';
    return trimmed;
};

export function ImageUpload({ value, onChange, disabled, className, hidePreview = false }) {
    const [open, setOpen] = useState(false);
    const [urlInput, setUrlInput] = useState(value || '');
    const [previewError, setPreviewError] = useState(false);
    const normalizedValue = normalizeValue(value);
    const hasPreview = Boolean(normalizedValue) && !previewError;

    useEffect(() => {
        setUrlInput(normalizedValue);
        setPreviewError(false);
    }, [normalizedValue]);

    const handleSelect = (file) => {
        let finalUrl = file.file_path;
        // If file_path is already a full URL (new behavior), use it directly.
        // Otherwise generate it from storage (legacy behavior).
        if (!finalUrl?.startsWith('http')) {
            const { data } = supabase.storage.from(file.bucket_name || 'cms-uploads').getPublicUrl(file.file_path);
            finalUrl = data.publicUrl;
        }

        if (finalUrl) {
            onChange(finalUrl);
            setUrlInput(finalUrl);
            setOpen(false);
        }
    };

    const handleUrlChange = (e) => {
        setUrlInput(e.target.value);
        onChange(e.target.value);
    };

    return (
        <div className={`space-y-4 ${className}`}>
            <div className="flex flex-col gap-4 md:flex-row md:items-start">
                {!hidePreview && (
                    <div className="w-36 h-36 shrink-0 rounded-2xl border border-slate-200/70 bg-slate-100/80 flex items-center justify-center overflow-hidden relative group dark:border-slate-800/70 dark:bg-slate-900/60">
                        {hasPreview ? (
                            <>
                                <img
                                    src={normalizedValue}
                                    alt=""
                                    className="w-full h-full object-cover"
                                    onError={() => setPreviewError(true)}
                                />
                                {!disabled && (
                                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                        <Button
                                            variant="destructive"
                                            size="icon"
                                            className="h-8 w-8 rounded-full"
                                            onClick={() => { onChange(''); setUrlInput(''); }}
                                        >
                                            <X className="w-4 h-4" />
                                        </Button>
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="flex flex-col items-center gap-2 text-slate-400">
                                <ImageIcon className="w-8 h-8" />
                                <span className="text-xs font-medium">No image</span>
                            </div>
                        )}
                    </div>
                )}

                <div className="flex-1 space-y-4">
                    <Tabs defaultValue="library" className="w-full">
                        <TabsList className="grid w-full grid-cols-2 rounded-xl bg-slate-100/80 p-1 text-sm text-slate-500 dark:bg-slate-800/70 dark:text-slate-400">
                            <TabsTrigger value="library" className="rounded-lg data-[state=active]:bg-white data-[state=active]:text-slate-900 dark:data-[state=active]:bg-slate-900 dark:data-[state=active]:text-white">Media Library</TabsTrigger>
                            <TabsTrigger value="url" className="rounded-lg data-[state=active]:bg-white data-[state=active]:text-slate-900 dark:data-[state=active]:bg-slate-900 dark:data-[state=active]:text-white">External URL</TabsTrigger>
                        </TabsList>

                        <TabsContent value="library" className="space-y-3 mt-4">
                            <p className="text-sm text-slate-500 mb-2">Select from your uploaded files or upload new ones.</p>
                            <Dialog open={open} onOpenChange={setOpen}>
                                <DialogTrigger asChild>
                                    <Button type="button" variant="outline" className="w-full" disabled={disabled}>
                                        <FolderOpen className="w-4 h-4 mr-2" />
                                        Browse Library
                                    </Button>
                                </DialogTrigger>
                                <DialogContent className="max-w-4xl h-[80vh] flex flex-col p-0 gap-0">
                                    <DialogHeader className="px-6 py-4 border-b">
                                        <DialogTitle>Select Media</DialogTitle>
                                    </DialogHeader>
                                    <div className="flex-1 min-h-0 overflow-hidden p-0">
                                        <MediaLibrary onSelect={handleSelect} selectionMode="single" />
                                    </div>
                                </DialogContent>
                            </Dialog>
                        </TabsContent>

                        <TabsContent value="url" className="space-y-3 mt-4">
                            <div className="space-y-2">
                                <Label>Image URL</Label>
                                <Input
                                    value={urlInput}
                                    onChange={handleUrlChange}
                                    placeholder="https://..."
                                    disabled={disabled}
                                    className="h-11 rounded-xl border-slate-200/70 bg-white/90 shadow-sm focus:border-indigo-500/60 focus:ring-indigo-500/30 dark:border-slate-700/70 dark:bg-slate-950/60"
                                />
                            </div>
                        </TabsContent>
                    </Tabs>
                </div>
            </div>
        </div>
    );
}

export default ImageUpload;
