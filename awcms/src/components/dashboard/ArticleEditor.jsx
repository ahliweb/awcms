import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Save, X, Globe, Calendar, Lock, Layout, Share2, FolderOpen,
    ChevronRight, ChevronLeft, Eye, Send, CheckCircle, AlertCircle,
    FileText, Image as ImageIcon, MoreVertical, ArrowLeft
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { usePermissions } from '@/contexts/PermissionContext';
import { ImageUpload } from '@/components/ui/ImageUpload';
import RichTextEditor from '@/components/ui/RichTextEditor';
import VisualPageBuilder from '@/components/visual-builder/VisualPageBuilder';
import TagInput from '@/components/ui/TagInput';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";

function ArticleEditor({ article, onClose, onSuccess }) {
    const { toast } = useToast();
    const { user } = useAuth();
    const { currentTenant } = useTenant();
    const { hasPermission } = usePermissions();
    const [loading, setLoading] = useState(false);
    const [categories, setCategories] = useState([]);
    const [currentState, setCurrentState] = useState(article?.workflow_state || 'draft');

    // Detect Visual Builder Mode
    // Check strict editor_type first, then fallback to content shape inspection
    const isVisualContent = article?.editor_type === 'visual' ||
        (article?.content && typeof article.content === 'object' && !Array.isArray(article.content) && article.content.root);

    const [useVisualBuilder, setUseVisualBuilder] = useState(isVisualContent);

    // UI State
    const [activeSection, setActiveSection] = useState('main'); // For mobile tabs if needed

    // Mobile Settings Toggle
    const [showMobileSettings, setShowMobileSettings] = useState(false);

    // Initial Form Data State
    const [formData, setFormData] = useState({
        title: article?.title || '',
        slug: article?.slug || '',
        content: article?.content || '',
        excerpt: article?.excerpt || '',
        featured_image: article?.featured_image || '',
        status: article?.status || 'draft',
        workflow_state: article?.workflow_state || 'draft',
        is_active: article?.is_active ?? true,
        is_public: article?.is_public ?? false,
        editor_type: article?.editor_type || (isVisualContent ? 'visual' : 'richtext'),
        category_id: article?.category_id || '',
        tags: article?.tags || [],

        // SEO
        meta_title: article?.meta_title || '',
        meta_description: article?.meta_description || '',
        meta_keywords: article?.meta_keywords || '',
        canonical_url: article?.canonical_url || '',
        robots: article?.robots || 'index, follow',

        // Social
        og_title: article?.og_title || '',
        og_description: article?.og_description || '',
        og_image: article?.og_image || '',
        twitter_card_type: article?.twitter_card_type || 'summary',
        twitter_image: article?.twitter_image || '',

        published_at: article?.published_at ? new Date(article.published_at).toISOString().slice(0, 16) : ''
    });

    const isEditMode = !!article;
    const WORKFLOW_STATES = {
        DRAFT: 'draft',
        REVIEWED: 'reviewed',
        APPROVED: 'approved',
        PUBLISHED: 'published',
        ARCHIVED: 'archived'
    };

    // Permissions
    const canEdit = hasPermission('tenant.articles.update') || (user?.id === article?.author_id);
    const canPublish = hasPermission('tenant.articles.publish');

    useEffect(() => {
        fetchCategories();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const fetchCategories = async () => {
        try {
            let q = supabase
                .from('categories')
                .select('id, name')
                .eq('type', 'articles');

            if (currentTenant?.id) {
                q = q.eq('tenant_id', currentTenant.id);
            }

            const { data, error } = await q;
            if (error) throw error;
            setCategories(data || []);
        } catch (error) {
            console.error('Error fetching categories:', error);
        }
    };

    const canTransition = (targetState) => {
        if (!isEditMode) return true; // Allow state changes for new articles too (if logic permits)
        return true;
    };

    const handleWorkflowAction = async (newState) => {
        await saveArticle(newState);
    };

    const generateSlug = (text) => {
        return text
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '');
    };

    const saveArticle = async (workflowStateOverride = null) => {
        if (!canEdit) {
            toast({ variant: 'destructive', title: 'Permission Denied', description: 'You cannot save this article.' });
            return;
        }

        if (!currentTenant?.id) {
            toast({ variant: 'destructive', title: 'System Error', description: 'No active tenant context found.' });
            return;
        }

        const finalWorkflowState = workflowStateOverride || currentState;
        let finalStatus = formData.status;

        // Workflow side-effects
        if (workflowStateOverride === WORKFLOW_STATES.PUBLISHED) {
            finalStatus = 'published';
        } else if (workflowStateOverride === WORKFLOW_STATES.DRAFT) {
            finalStatus = 'draft';
        }

        if (finalStatus === 'published' && !canPublish) {
            toast({ variant: 'destructive', title: 'Publishing Restricted', description: 'You do not have permission to publish. Saved as draft.' });
            finalStatus = 'draft';
        }

        setLoading(true);

        try {
            const dataToSave = {
                tenant_id: currentTenant.id,
                title: formData.title,
                slug: formData.slug || generateSlug(formData.title),
                content: formData.content,
                excerpt: formData.excerpt,
                featured_image: formData.featured_image,
                status: finalStatus,
                workflow_state: finalWorkflowState,
                is_active: formData.is_active,
                is_public: formData.is_public,
                category_id: formData.category_id || null,
                // SEO
                meta_title: formData.meta_title,
                meta_description: formData.meta_description,
                meta_keywords: formData.meta_keywords,
                canonical_url: formData.canonical_url,
                robots: formData.robots,
                // Social
                og_title: formData.og_title,
                og_description: formData.og_description,
                og_image: formData.og_image,
                twitter_card_type: formData.twitter_card_type,
                twitter_image: formData.twitter_image,
                published_at: formData.published_at || null,
                updated_at: new Date().toISOString()
            };

            if (!isEditMode) {
                dataToSave.created_by = user.id;
                dataToSave.author_id = user.id;
            }

            let savedArticleId = article?.id;

            if (article) {
                delete dataToSave.tenant_id; // Don't update tenant_id
                const { error } = await supabase
                    .from('articles')
                    .update(dataToSave)
                    .eq('id', article.id);

                if (error) throw error;
                toast({ title: "Success", description: `Article saved as ${finalWorkflowState}` });
            } else {
                const { data, error } = await supabase
                    .from('articles')
                    .insert([dataToSave])
                    .select('id')
                    .single();

                if (error) throw error;
                savedArticleId = data.id;
                toast({ title: "Success", description: "Article created successfully" });
            }

            // Sync Tags
            if (savedArticleId) {
                await supabase.rpc('sync_resource_tags', {
                    p_resource_id: savedArticleId,
                    p_resource_type: 'articles',
                    p_tags: formData.tags,
                    p_tenant_id: currentTenant.id
                });
            }

            if (workflowStateOverride) {
                setCurrentState(workflowStateOverride);
            }
            if (finalStatus !== formData.status) {
                setFormData(prev => ({ ...prev, status: finalStatus }));
            }

            if (!isEditMode && onSuccess) {
                onSuccess();
                onClose();
            } else if (onSuccess) {
                // onSuccess(); // Refresh parent if needed
            }

        } catch (error) {
            console.error(error);
            toast({
                variant: "destructive",
                title: "Error",
                description: error.message || "Failed to save article"
            });
        } finally {
            setLoading(false);
        }
    };

    // State Colors Helper
    const getStateColor = (state) => {
        switch (state) {
            case 'published': return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20';
            case 'approved': return 'bg-blue-500/10 text-blue-600 border-blue-500/20';
            case 'reviewed': return 'bg-amber-500/10 text-amber-600 border-amber-500/20';
            default: return 'bg-slate-500/10 text-slate-600 border-slate-500/20';
        }
    };

    if (useVisualBuilder) {
        return createPortal(
            <VisualPageBuilder
                page={article}
                onClose={onClose}
                onSuccess={onSuccess}
                mode="article" // Custom prop we added support for
                pageId={article?.id} // Helper for mode='article' logic
            />,
            document.body
        );
    }

    // ... (rest of component logic)

    // Helper to render in portal
    const renderEditor = () => (
        <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[100] flex flex-col bg-slate-50/50 backdrop-blur-sm"
        >
            {/* 1. Blur Overlay Background - Optional visual depth */}
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-50/50 via-white/50 to-blue-50/50 -z-10" />

            {/* 2. Top Navigation / Header */}
            <div className="h-16 px-6 border-b border-white/60 bg-white/80 backdrop-blur-xl flex items-center justify-between shadow-sm z-50">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" onClick={onClose} className="hover:bg-slate-100/50 gap-2 pr-4 text-slate-600 rounded-full">
                        <ChevronLeft className="w-5 h-5" />
                        <span className="font-medium hidden sm:inline-block">Back</span>
                    </Button>
                    <Separator orientation="vertical" className="h-6" />
                    <div>
                        <div className="flex items-center gap-2">
                            <Input
                                value={formData.title}
                                onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value, slug: !article ? generateSlug(e.target.value) : prev.slug }))}
                                className="border-none shadow-none bg-transparent text-lg font-bold px-0 h-auto focus-visible:ring-0 placeholder:text-slate-400 min-w-[300px]"
                                placeholder="Untitled Article"
                            />
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                            <Badge variant="outline" className={`${getStateColor(currentState)} border px-1.5 py-0 rounded-sm font-normal uppercase tracking-wider text-[10px]`}>
                                {currentState}
                            </Badge>
                            <span>•</span>
                            <span>{formData.slug ? formData.slug : 'slug-placeholder'}</span>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2">
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

                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                        if (confirm('Switching to Visual Builder might affect existing content formatting. Continue?')) {
                                            setUseVisualBuilder(true);
                                        }
                                    }}
                                    className="text-slate-500 hover:text-indigo-600 hidden sm:flex gap-2"
                                >
                                    <Layout className="w-4 h-4" />
                                    <span className="hidden lg:inline">Visual Builder</span>
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Switch to Visual Editor</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>

                    <Separator orientation="vertical" className="h-6" />

                    <Button variant="ghost" onClick={onClose} className="hidden sm:flex text-slate-500 hover:text-slate-700 hover:bg-slate-100 ring-0 focus:ring-0">
                        Cancel
                    </Button>

                    {/* Mobile Settings Toggle */}
                    <Button variant="ghost" size="icon" className="lg:hidden text-slate-500" onClick={() => setShowMobileSettings(true)}>
                        <MoreVertical className="w-5 h-5" />
                    </Button>

                    {/* Workflow Actions */}
                    {currentState === WORKFLOW_STATES.DRAFT && (
                        <Button onClick={() => handleWorkflowAction(WORKFLOW_STATES.REVIEWED)} variant="secondary" className="hidden sm:flex" size="sm">
                            Request Review
                        </Button>
                    )}
                    {currentState === WORKFLOW_STATES.REVIEWED && (
                        <Button onClick={() => handleWorkflowAction(WORKFLOW_STATES.APPROVED)} className="bg-blue-600 hover:bg-blue-700 text-white hidden sm:flex" size="sm">
                            Approve
                        </Button>
                    )}

                    <Button
                        onClick={() => saveArticle(currentState === WORKFLOW_STATES.PUBLISHED ? null : WORKFLOW_STATES.PUBLISHED)}
                        className={`${currentState === WORKFLOW_STATES.PUBLISHED ? 'bg-slate-900' : 'bg-emerald-600 hover:bg-emerald-700'} text-white shadow-lg shadow-emerald-500/20`}
                        disabled={loading}
                    >
                        {loading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" /> : (currentState === WORKFLOW_STATES.PUBLISHED ? <Save className="w-4 h-4 mr-2" /> : <Send className="w-4 h-4 mr-2" />)}
                        {currentState === WORKFLOW_STATES.PUBLISHED ? 'Save Changes' : 'Publish'}
                    </Button>
                </div>
            </div>

            {/* 3. Main Workspace - 2 Columns */}
            <div className="flex-1 overflow-hidden">
                <div className="h-full flex flex-col lg:flex-row max-w-[1600px] mx-auto">

                    {/* Left: Main Content (Scrollable) */}
                    <ScrollArea className="flex-1 h-full">
                        <div className="p-8 lg:p-12 max-w-4xl mx-auto space-y-8 pb-32">

                            {/* Featured Image - Banner Style */}
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
                                        className="h-full w-full opacity-0 absolute inset-0 cursor-pointer" // Invisible overlay trigger
                                    />
                                    <Button variant="secondary" className="pointer-events-none">Change Cover</Button>
                                </div>
                            </div>

                            {/* Excerpt */}
                            <div className="space-y-2">
                                <Label className="text-slate-500 uppercase tracking-widest text-[11px] font-semibold pl-1">Introduction / Excerpt</Label>
                                <Textarea
                                    value={formData.excerpt}
                                    onChange={(e) => setFormData(p => ({ ...p, excerpt: e.target.value }))}
                                    className="bg-transparent border-none focus-visible:ring-0 px-0 text-lg text-slate-600 resize-none min-h-[80px] placeholder:text-slate-300"
                                    placeholder="Add a short introduction..."
                                />
                            </div>

                            <Separator className="bg-slate-100" />

                            {/* Rich Editor */}
                            <div className="min-h-[500px]">
                                <RichTextEditor
                                    value={formData.content}
                                    onChange={(val) => setFormData(p => ({ ...p, content: val }))}
                                    placeholder="Tell your story..."
                                    className="prose-lg max-w-none"
                                />
                            </div>
                        </div>
                    </ScrollArea>

                    {/* Right: Sidebar (Settings) - Glassy */}
                    <div className={`w-full lg:w-[380px] border-l border-white/60 bg-white/60 backdrop-blur-md h-full overflow-y-auto ${showMobileSettings ? 'fixed inset-0 z-[110] bg-white' : 'hidden lg:block'}`}>
                        {/* Mobile Sidebar Header */}
                        {showMobileSettings && (
                            <div className="flex items-center justify-between p-4 border-b lg:hidden">
                                <span className="font-semibold">Article Settings</span>
                                <Button variant="ghost" size="icon" onClick={() => setShowMobileSettings(false)}>
                                    <X className="w-5 h-5" />
                                </Button>
                            </div>
                        )}
                        <div className="p-6 space-y-8">



                            {/* Organization */}
                            <div className="space-y-4">
                                <h4 className="flex items-center gap-2 font-semibold text-slate-800 text-sm">
                                    <FolderOpen className="w-4 h-4 text-indigo-500" /> Organization
                                </h4>
                                <div className="space-y-4 bg-white/50 p-4 rounded-xl border border-white/60 shadow-sm">
                                    <div className="space-y-2">
                                        <Label className="text-slate-500 uppercase tracking-widest text-[11px] font-semibold pl-1">Category</Label>
                                        <Select
                                            value={formData.category_id}
                                            onValueChange={(val) => setFormData({ ...formData, category_id: val })}
                                        >
                                            <SelectTrigger className="w-full bg-white/80 border-slate-200">
                                                <SelectValue placeholder="Select Category..." />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {categories.map(cat => <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="text-slate-500 uppercase tracking-widest text-[11px] font-semibold pl-1">Tags</Label>
                                        <TagInput
                                            value={formData.tags}
                                            onChange={(tags) => setFormData(p => ({ ...p, tags: tags }))}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Visibility & SEO */}
                            <div className="space-y-4">
                                <h4 className="flex items-center gap-2 font-semibold text-slate-800 text-sm">
                                    <Globe className="w-4 h-4 text-emerald-500" /> Visibility
                                </h4>
                                <div className="space-y-4 bg-white/50 p-4 rounded-xl border border-white/60 shadow-sm">
                                    <div className="flex items-center justify-between">
                                        <div className="space-y-0.5">
                                            <Label className="text-sm">Publicly Visible</Label>
                                            <p className="text-[10px] text-slate-500">Visible to all visitors</p>
                                        </div>
                                        <Switch
                                            checked={formData.is_public}
                                            onCheckedChange={(c) => setFormData(p => ({ ...p, is_public: c }))}
                                        />
                                    </div>
                                    <Separator className="bg-slate-100" />
                                    <div className="space-y-2">
                                        <Label className="text-xs text-slate-500">Meta Title</Label>
                                        <Input
                                            value={formData.meta_title}
                                            onChange={(e) => setFormData(p => ({ ...p, meta_title: e.target.value }))}
                                            className="h-8 text-xs"
                                            placeholder="SEO Title"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="text-xs text-slate-500">Meta Description</Label>
                                        <Textarea
                                            value={formData.meta_description}
                                            onChange={(e) => setFormData(p => ({ ...p, meta_description: e.target.value }))}
                                            className="min-h-[60px] text-xs resize-none"
                                            placeholder="SEO Description"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Social */}
                            <div className="space-y-4">
                                <h4 className="flex items-center gap-2 font-semibold text-slate-800 text-sm">
                                    <Share2 className="w-4 h-4 text-sky-500" /> Social
                                </h4>
                                <div className="bg-white/50 p-4 rounded-xl border border-white/60 shadow-sm space-y-4">
                                    <div className="space-y-2">
                                        <Label className="text-xs text-slate-500">OG Title</Label>
                                        <Input
                                            value={formData.og_title}
                                            onChange={(e) => setFormData(p => ({ ...p, og_title: e.target.value }))}
                                            className="h-8 text-xs"
                                            placeholder="Social Title"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="text-xs text-slate-500">OG Description</Label>
                                        <Textarea
                                            value={formData.og_description}
                                            onChange={(e) => setFormData(p => ({ ...p, og_description: e.target.value }))}
                                            className="min-h-[60px] text-xs resize-none"
                                            placeholder="Social Description"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="text-xs text-slate-500">OG Image</Label>
                                        <ImageUpload
                                            value={formData.og_image}
                                            onChange={(url) => setFormData(p => ({ ...p, og_image: url }))}
                                            className="h-24 w-full"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="text-xs text-slate-400 pt-8 text-center">
                                Last saved: {new Date().toLocaleTimeString()}
                            </div>

                        </div>
                    </div>
                </div>
            </div>
        </motion.div>
    );

    return createPortal(renderEditor(), document.body);
}

export default ArticleEditor;
