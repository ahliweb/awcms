import { useState } from 'react';
import { Label } from '@/components/ui/label';
import RichTextEditor from '@/components/ui/RichTextEditor';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import MediaLibrary from '@/components/dashboard/media/MediaLibrary';
import { PageLinkField } from './PageLinkField';
import { resolveMediaUrl } from '@/lib/media';


/**
 * Rich Text Field for Puck Editor
 * Integrates the application's RichTextEditor with Puck's field system
 */
export const RichTextField = ({ field, value, onChange, name }) => {
    const [mediaOpen, setMediaOpen] = useState(false);
    const [linkOpen, setLinkOpen] = useState(false);
    const [editorInstance, setEditorInstance] = useState(null);
    const [linkUrl, setLinkUrl] = useState('');

    const handleImageAdd = (editor) => {
        setEditorInstance(editor);
        setMediaOpen(true);
    };

    const handleLinkAdd = (editor) => {
        setEditorInstance(editor);
        // If there's a selection with a link, prepopulate? 
        // Tiptap's editor.getAttributes('link').href might work if we select the link first.
        const previousUrl = editor.getAttributes('link').href;
        setLinkUrl(previousUrl || '');
        setLinkOpen(true);
    };

    const handleMediaSelect = (file) => {
        if (!editorInstance) return;

        const finalUrl = resolveMediaUrl(file);

        if (finalUrl) {
            editorInstance.chain().focus().setImage({ src: finalUrl }).run();
            setMediaOpen(false);
            setEditorInstance(null);

            // Trigger onChange with new HTML content
            onChange(editorInstance.getHTML());
        }
    };

    const confirmLink = () => {
        if (editorInstance && linkUrl) {
            // Check if selection is empty. If so, insert the URL as text? 
            // Or just extendMarkRange.
            // If empty selection, we should probably insert text?
            // Tiptap's setLink works on selection.
            if (editorInstance.state.selection.empty) {
                editorInstance.chain().focus()
                    .insertContent(`<a href="${linkUrl}">${linkUrl}</a>`)
                    .run();
            } else {
                editorInstance.chain().focus().extendMarkRange('link').setLink({ href: linkUrl }).run();
            }

            setLinkOpen(false);
            setEditorInstance(null);
            setLinkUrl('');

            // Trigger onChange
            onChange(editorInstance.getHTML());
        } else if (editorInstance && !linkUrl) {
            // If empty, unset link
            editorInstance.chain().focus().unsetLink().run();
            setLinkOpen(false);
            setEditorInstance(null);
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
                onLinkAdd={handleLinkAdd}
                className="min-h-[200px]"
            />

            {/* Media/Image Dialog */}
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

            {/* Link Dialog */}
            <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Insert / Edit Link</DialogTitle>
                    </DialogHeader>
                    <div className="py-4">
                        <PageLinkField
                            name="linkUrl"
                            field={{ label: 'URL or Page' }}
                            value={linkUrl}
                            onChange={setLinkUrl}
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setLinkOpen(false)}>Cancel</Button>
                        <Button onClick={confirmLink}>Set Link</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default RichTextField;
