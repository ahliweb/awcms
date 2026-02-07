/**
 * UnifiedContentEditor - A multi-mode content editor supporting Visual, RichText, and Markdown modes.
 * 
 * This component serves as the core editor for both pages and blogs,
 * providing a consistent editing experience with mode switching capabilities.
 */
import React, { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import {
    X, ChevronLeft, Eye, Send, Image as ImageIcon, MoreVertical,
    Layout, FileText, Code2, Loader2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { useContent } from '@/hooks/useContent'; // Import new hook
import { usePermissions } from '@/contexts/PermissionContext';
import { ImageUpload } from '@/components/ui/ImageUpload';
import RichTextEditor from '@/components/ui/RichTextEditor';
import VisualPageBuilder from '@/components/visual-builder/VisualPageBuilder';
import TagInput from '@/components/ui/TagInput';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import SeoMetadataPanel from './SeoMetadataPanel';

// Editor mode types
const EDITOR_MODES = {
    VISUAL: 'visual',
    RICHTEXT: 'richtext',
    MARKDOWN: 'markdown'
};

/**
 * UnifiedContentEditor Component
 * 
 * @param {Object} props
 * @param {Object} props.content - The content object (page or blog)
 * @param {'page' | 'blog'} props.contentType - Type of content being edited
 * @param {Function} props.onClose - Callback when editor is closed
 * @param {Function} props.onSuccess - Callback on successful save
 * @param {string} props.tableName - Database table name ('pages' or 'blogs')
 * @param {string} props.permissionPrefix - Permission prefix for ABAC checks
 */
function UnifiedContentEditor({
    content,
    contentType = 'page',
    onClose,
    onSuccess,
    tableName = 'pages',
    permissionPrefix = 'pages'
}) {
    const { toast } = useToast();
    const { hasPermission } = usePermissions();
    
    // Use the new content hook
    const { fetchCategories, saveContent, loading: contentLoading } = useContent(contentType);
    
    const [categories, setCategories] = useState([]);

    // Determine initial editor mode
    const getInitialMode = () => {
        if (content?.editor_type === 'visual') return EDITOR_MODES.VISUAL;
        if (content?.editor_type === 'markdown') return EDITOR_MODES.MARKDOWN;
        return EDITOR_MODES.RICHTEXT;
    };

    const [editorMode, setEditorMode] = useState(getInitialMode());
    const [showModeSwitch, setShowModeSwitch] = useState(false);
    const [pendingMode, setPendingMode] = useState(null);
    const [showMobileSettings, setShowMobileSettings] = useState(false);

    // Form state
    const [formData, setFormData] = useState({
        title: content?.title || '',
        slug: content?.slug || '',
        content: content?.content || '',
        excerpt: content?.excerpt || '',
        featured_image: content?.featured_image || '',
        status: content?.status || 'draft',
        workflow_state: content?.workflow_state || 'draft',
        is_active: content?.is_active ?? true,
        is_public: content?.is_public ?? false,
        editor_type: content?.editor_type || 'richtext',
        category_id: content?.category_id || '',
        tags: content?.tags || [],
        // SEO fields
        meta_title: content?.meta_title || '',
        meta_description: content?.meta_description || '',
        meta_keywords: content?.meta_keywords || '',
        og_image: content?.og_image || '',
        canonical_url: content?.canonical_url || ''
    });

    const isEditMode = !!content?.id;

    // Permissions
    const canEdit = hasPermission(`tenant.${permissionPrefix}.update`);
    const canPublish = hasPermission(`tenant.${permissionPrefix}.publish`);

    // Fetch categories on mount
    useEffect(() => {
        const loadCategories = async () => {
            const cats = await fetchCategories();
            setCategories(cats);
        };
        loadCategories();
    }, [fetchCategories]);

    const generateSlug = useCallback((text) => {
        return text
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '');
    }, []);

    const handleModeSwitch = (newMode) => {
        if (newMode === editorMode) return;
        setPendingMode(newMode);
        setShowModeSwitch(true);
    };

    const confirmModeSwitch = () => {
        setEditorMode(pendingMode);
        setFormData(prev => ({ ...prev, editor_type: pendingMode }));
        setShowModeSwitch(false);
        setPendingMode(null);
    };

    const handleSave = async (publish = false) => {
        // Permission checks are also handled in useContent, but we keep UI checks here for immediate feedback
        if (!canEdit) {
            toast({ variant: 'destructive', title: 'Permission Denied' });
            return;
        }

        const finalStatus = publish ? 'published' : formData.status;

        if (publish && !canPublish) {
            toast({ variant: 'destructive', title: 'Publishing Restricted' });
            return;
        }

        const dataToSave = {
            title: formData.title,
            slug: formData.slug || generateSlug(formData.title),
            content: formData.content,
            excerpt: formData.excerpt,
            featured_image: formData.featured_image,
            status: finalStatus,
            workflow_state: publish ? 'published' : formData.workflow_state,
            is_active: formData.is_active,
            is_public: formData.is_public,
            editor_type: editorMode,
            category_id: formData.category_id || null,
            // SEO
            meta_title: formData.meta_title,
            meta_description: formData.meta_description,
            meta_keywords: formData.meta_keywords,
            og_image: formData.og_image,
            canonical_url: formData.canonical_url,
            tags: formData.tags
        };

        const savedId = await saveContent(dataToSave, isEditMode, content?.id);

        if (savedId) {
            if (onSuccess) onSuccess();
            if (!isEditMode) onClose();
        }
    };

    // If visual mode, render VisualPageBuilder directly
    if (editorMode === EDITOR_MODES.VISUAL) {
        return createPortal(
            <VisualPageBuilder
                page={content}
                onClose={onClose}
                onSuccess={onSuccess}
                mode={contentType}
            />,
            document.body
        );
    }

    const renderEditor = () => (
        <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[100] flex flex-col bg-slate-50/50 backdrop-blur-sm"
        >
            {/* Header */}
            <div className="h-16 px-6 border-b border-white/60 bg-white/80 backdrop-blur-xl flex items-center justify-between shadow-sm z-50">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" onClick={onClose} className="hover:bg-slate-100/50 gap-2 pr-4 text-slate-600 rounded-full">
                        <ChevronLeft className="w-5 h-5" />
                        <span className="font-medium hidden sm:inline-block">Back</span>
                    </Button>
                    <Separator orientation="vertical" className="h-6" />
                    <div>
                        <Input
                            value={formData.title}
                            onChange={(e) => setFormData(prev => ({
                                ...prev,
                                title: e.target.value,
                                slug: !isEditMode ? generateSlug(e.target.value) : prev.slug
                            }))}
                            className="border-none shadow-none bg-transparent text-lg font-bold px-0 h-auto focus-visible:ring-0 placeholder:text-slate-400 min-w-[300px]"
                            placeholder={`Untitled ${contentType}`}
                        />
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                            <Badge variant="outline" className="px-1.5 py-0 rounded-sm font-normal uppercase tracking-wider text-[10px]">
                                {formData.status}
                            </Badge>
                            <span>•</span>
                            <span>{formData.slug || 'slug-placeholder'}</span>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {/* Editor Mode Tabs */}
                    <Tabs value={editorMode} className="hidden md:block">
                        <TabsList className="bg-slate-100 h-8">
                            <TabsTrigger
                                value={EDITOR_MODES.RICHTEXT}
                                onClick={() => handleModeSwitch(EDITOR_MODES.RICHTEXT)}
                                className="text-xs h-6 px-2 data-[state=active]:bg-white"
                            >
                                <FileText className="w-3 h-3 mr-1" />
                                Rich Text
                            </TabsTrigger>
                            <TabsTrigger
                                value={EDITOR_MODES.MARKDOWN}
                                onClick={() => handleModeSwitch(EDITOR_MODES.MARKDOWN)}
                                className="text-xs h-6 px-2 data-[state=active]:bg-white"
                            >
                                <Code2 className="w-3 h-3 mr-1" />
                                Markdown
                            </TabsTrigger>
                            <TabsTrigger
                                value={EDITOR_MODES.VISUAL}
                                onClick={() => handleModeSwitch(EDITOR_MODES.VISUAL)}
                                className="text-xs h-6 px-2 data-[state=active]:bg-white"
                            >
                                <Layout className="w-3 h-3 mr-1" />
                                Visual
                            </TabsTrigger>
                        </TabsList>
                    </Tabs>

                    <Separator orientation="vertical" className="h-6 hidden md:block" />

                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="text-slate-500">
                                    <Eye className="w-4 h-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Preview</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>

                    <Button variant="ghost" size="icon" className="lg:hidden text-slate-500" onClick={() => setShowMobileSettings(true)}>
                        <MoreVertical className="w-5 h-5" />
                    </Button>

                    <Button variant="ghost" onClick={onClose} className="hidden sm:flex text-slate-500">
                        Cancel
                    </Button>

                    <Button
                        onClick={() => handleSave(formData.status !== 'published')}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg"
                        disabled={contentLoading}
                    >
                        {contentLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                        {formData.status === 'published' ? 'Save' : 'Publish'}
                    </Button>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 overflow-hidden">
                <div className="h-full flex flex-col lg:flex-row max-w-[1600px] mx-auto">
                    {/* Editor Area */}
                    <ScrollArea className="flex-1 h-full">
                        <div className="p-8 lg:p-12 max-w-4xl mx-auto space-y-8 pb-32">
                            {/* Featured Image */}
                            <div className="group relative rounded-2xl overflow-hidden bg-slate-100 border border-slate-200 aspect-video max-h-[300px] hover:shadow-md transition-all">
                                {formData.featured_image ? (
                                    <img src={formData.featured_image} alt="Cover" className="w-full h-full object-cover" />
                                ) : (
                                    <div className="flex flex-col items-center justify-center h-full text-slate-400">
                                        <ImageIcon className="w-10 h-10 mb-2 opacity-50" />
                                        <span className="text-sm font-medium">Add Cover Image</span>
                                    </div>
                                )}
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                                    <ImageUpload
                                        value={formData.featured_image}
                                        onChange={(url) => setFormData(prev => ({ ...prev, featured_image: url }))}
                                        className="h-full w-full opacity-0 absolute inset-0 cursor-pointer"
                                    />
                                    <Button variant="secondary" className="pointer-events-none">Change Cover</Button>
                                </div>
                            </div>

                            {/* Excerpt */}
                            <div className="space-y-2">
                                <Label className="text-slate-500 uppercase tracking-widest text-[11px] font-semibold pl-1">Excerpt</Label>
                                <Textarea
                                    value={formData.excerpt}
                                    onChange={(e) => setFormData(p => ({ ...p, excerpt: e.target.value }))}
                                    className="bg-transparent border-none focus-visible:ring-0 px-0 text-lg text-slate-600 resize-none min-h-[80px] placeholder:text-slate-300"
                                    placeholder="Add a short introduction..."
                                />
                            </div>

                            <Separator className="bg-slate-100" />

                            {/* Content Editor */}
                            <div className="min-h-[500px]">
                                {editorMode === EDITOR_MODES.MARKDOWN ? (
                                    <Textarea
                                        value={formData.content}
                                        onChange={(e) => setFormData(p => ({ ...p, content: e.target.value }))}
                                        className="min-h-[500px] font-mono text-sm bg-slate-900 text-slate-100 rounded-lg p-4 resize-none"
                                        placeholder="# Write your content in Markdown..."
                                    />
                                ) : (
                                    <RichTextEditor
                                        value={formData.content}
                                        onChange={(val) => setFormData(p => ({ ...p, content: val }))}
                                        placeholder="Start writing..."
                                        className="prose-lg max-w-none"
                                    />
                                )}
                            </div>
                        </div>
                    </ScrollArea>

                    {/* Settings Sidebar */}
                    <div className={`w-full lg:w-[380px] border-l border-white/60 bg-white/60 backdrop-blur-md h-full overflow-y-auto ${showMobileSettings ? 'fixed inset-0 z-[110] bg-white' : 'hidden lg:block'}`}>
                        {showMobileSettings && (
                            <div className="flex items-center justify-between p-4 border-b lg:hidden">
                                <span className="font-semibold">Settings</span>
                                <Button variant="ghost" size="icon" onClick={() => setShowMobileSettings(false)}>
                                    <X className="w-5 h-5" />
                                </Button>
                            </div>
                        )}
                        <div className="p-6 space-y-8">
                            {/* Category & Tags */}
                            <div className="space-y-4">
                                <h4 className="font-semibold text-slate-800 text-sm">Organization</h4>
                                <div className="space-y-4 bg-white/50 p-4 rounded-xl border border-white/60 shadow-sm">
                                    <div className="space-y-2">
                                        <Label className="text-xs text-slate-500">Category</Label>
                                        <Select
                                            value={formData.category_id}
                                            onValueChange={(val) => setFormData({ ...formData, category_id: val })}
                                        >
                                            <SelectTrigger className="w-full bg-white/80 border-slate-200">
                                                <SelectValue placeholder="Select Category..." />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {categories.map(cat => (
                                                    <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="text-xs text-slate-500">Tags</Label>
                                        <TagInput
                                            value={formData.tags}
                                            onChange={(tags) => setFormData(p => ({ ...p, tags }))}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* SEO Panel */}
                            <SeoMetadataPanel
                                formData={formData}
                                onChange={(updates) => setFormData(prev => ({ ...prev, ...updates }))}
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Mode Switch Confirmation */}
            <AlertDialog open={showModeSwitch} onOpenChange={setShowModeSwitch}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Switch Editor Mode?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Switching modes may affect content formatting. Visual mode will open a new editor.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => setPendingMode(null)}>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmModeSwitch} className="bg-indigo-600 hover:bg-indigo-700">
                            Switch
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </motion.div>
    );

    return createPortal(renderEditor(), document.body);
}

export default UnifiedContentEditor;
