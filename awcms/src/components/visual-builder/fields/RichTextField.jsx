
import { useState } from 'react';
import { Label } from '@/components/ui/label';
import RichTextEditor from '@/components/ui/RichTextEditor';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import MediaLibrary from '@/components/dashboard/media/MediaLibrary';
import { supabase } from '@/lib/customSupabaseClient';

/**
 * Rich Text Field for Puck Editor
 * Integrates the application's RichTextEditor with Puck's field system
 */
export const RichTextField = ({ field, value, onChange, name }) => {
    const [mediaOpen, setMediaOpen] = useState(false);
    const [editorInstance, setEditorInstance] = useState(null);

    const handleImageAdd = (editor) => {
        setEditorInstance(editor);
        setMediaOpen(true);
    };

    const handleMediaSelect = (file) => {
        if (!editorInstance) return;

        const { data } = supabase.storage
            .from(file.bucket_name || 'cms-uploads')
            .getPublicUrl(file.file_path);

        if (data.publicUrl) {
            editorInstance.chain().focus().setImage({ src: data.publicUrl }).run();
            setMediaOpen(false);
            setEditorInstance(null);

            // Trigger onChange with new HTML content
            onChange(editorInstance.getHTML());
        }
    };

    return (
        <div className="space-y-3">
            <Label>{field.label || name}</Label>

            <RichTextEditor
                value={value}
                onChange={onChange}
                placeholder={field.placeholder || "Enter content..."}
                onImageAdd={handleImageAdd}
                className="min-h-[200px]"
            />

            <Dialog open={mediaOpen} onOpenChange={setMediaOpen}>
                <DialogContent className="max-w-4xl h-[80vh] flex flex-col p-0 gap-0">
                    <DialogHeader className="px-6 py-4 border-b">
                        <DialogTitle>Insert Image</DialogTitle>
                    </DialogHeader>
                    <div className="flex-1 min-h-0 overflow-hidden p-0">
                        <MediaLibrary onSelect={handleMediaSelect} selectionMode="single" />
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default RichTextField;
