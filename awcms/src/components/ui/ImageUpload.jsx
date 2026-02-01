
import React, { useState } from 'react';
import { X, Image as ImageIcon, FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogTrigger, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import MediaLibrary from '@/components/dashboard/media/MediaLibrary';
import { supabase } from '@/lib/customSupabaseClient';

// Enhanced ImageUpload that includes FilePicker
export function ImageUpload({ value, onChange, disabled, className }) {
    const [open, setOpen] = useState(false);
    const [urlInput, setUrlInput] = useState(value || '');

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
            <div className="flex gap-4 items-start">
                {/* Preview */}
                <div className="w-40 h-40 shrink-0 bg-slate-100 rounded-lg border border-slate-200 flex items-center justify-center overflow-hidden relative group">
                    {value ? (
                        <>
                            <img src={value} alt="Preview" className="w-full h-full object-cover" />
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
                        <ImageIcon className="w-10 h-10 text-slate-300" />
                    )}
                </div>

                {/* Controls */}
                <div className="flex-1 space-y-4">
                    <Tabs defaultValue="library" className="w-full">
                        <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="library">Media Library</TabsTrigger>
                            <TabsTrigger value="url">External URL</TabsTrigger>
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
