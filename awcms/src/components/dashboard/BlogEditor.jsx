import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import {
    Save, X, Globe, Layout, Share2, FolderOpen,
    ChevronLeft, Eye, Send, Image as ImageIcon, MoreVertical
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { triggerPublicRebuild } from '@/lib/publicRebuild';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { usePermissions } from '@/contexts/PermissionContext';
import { ImageUpload } from '@/components/ui/ImageUpload';
import RichTextEditor from '@/components/ui/RichTextEditor';
import VisualPageBuilder from '@/components/visual-builder/VisualPageBuilder';
import TagInput from '@/components/ui/TagInput';
import { getCategoryTypesForModule } from '@/lib/taxonomy';
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
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

const DEFAULT_BLOG_LOCALE = 'id';

function mapBlogTranslationToFormData(item, translation) {
    return {
        title: item?.title || '',
        slug: item?.slug || '',
        content: item?.content || '',
        excerpt: item?.excerpt || '',
        featured_image: item?.featured_image || '',
        status: item?.status || 'draft',
        workflow_state: item?.workflow_state || 'draft',
        is_active: item?.is_active ?? true,
        is_public: item?.is_public ?? false,
        category_id: item?.category_id || '',
        tags: item?.tags || [],
        meta_title: item?.meta_title || '',
        meta_description: item?.meta_description || '',
        meta_keywords: item?.meta_keywords || '',
        canonical_url: item?.canonical_url || '',
        robots: item?.robots || 'index, follow',
        og_title: item?.og_title || '',
        og_description: item?.og_description || '',
        og_image: item?.og_image || '',
        twitter_card_type: item?.twitter_card_type || 'summary',
        twitter_image: item?.twitter_image || '',
        published_at: item?.published_at ? new Date(item.published_at).toISOString().slice(0, 16) : '',
        title_en: translation?.title || '',
        slug_en: translation?.slug || '',
        content_en: translation?.content || '',
        excerpt_en: translation?.excerpt || '',
        meta_description_en: translation?.meta_description || '',
    };
}

function BlogEditor({ item, onClose, onSuccess, translationConfig = null, selectedLanguage = DEFAULT_BLOG_LOCALE }) {
    const { toast } = useToast();
    const { user } = useAuth();
    const { currentTenant } = useTenant();
    const { hasPermission } = usePermissions();
    const [loading, setLoading] = useState(false);
    const [categories, setCategories] = useState([]);
    const [currentState, setCurrentState] = useState(item?.workflow_state || 'draft');

    // Detect Visual Builder Mode
    // Check strict editor_type first, then fallback to content shape inspection
    const isVisualContent = item?.editor_type === 'visual' ||
        (item?.content && typeof item.content === 'object' && !Array.isArray(item.content) && item.content.root);

    const [useVisualBuilder, setUseVisualBuilder] = useState(isVisualContent);

    // Mobile Settings Toggle
    const [showMobileSettings, setShowMobileSettings] = useState(false);
    const [visualSwitchOpen, setVisualSwitchOpen] = useState(false);
    const [coverImageOpen, setCoverImageOpen] = useState(false);

    // Initial Form Data State
    const [formData, setFormData] = useState(() => mapBlogTranslationToFormData(item, null));

    const isTranslatedLocale = Boolean(translationConfig && selectedLanguage === translationConfig.locale);
    const activeTitleKey = isTranslatedLocale ? 'title_en' : 'title';
    const activeSlugKey = isTranslatedLocale ? 'slug_en' : 'slug';
    const activeExcerptKey = isTranslatedLocale ? 'excerpt_en' : 'excerpt';
    const activeContentKey = isTranslatedLocale ? 'content_en' : 'content';
    const activeMetaDescriptionKey = isTranslatedLocale ? 'meta_description_en' : 'meta_description';

    const isEditMode = !!item;
    const isNewBlog = !isEditMode;
    const WORKFLOW_STATES = {
        DRAFT: 'draft',
        REVIEWED: 'reviewed',
        APPROVED: 'approved',
        PUBLISHED: 'published',
        ARCHIVED: 'archived'
    };

    // Permissions
    const canEdit = hasPermission('tenant.blog.update') || (user?.id === item?.author_id);
    const canPublish = hasPermission('tenant.blog.publish');

    const fetchCategories = useCallback(async () => {
        try {
            let query = supabase
                .from('categories')
                .select('id, name')
                .in('type', getCategoryTypesForModule('blogs'))
                .is('deleted_at', null)
                .order('name');

            if (currentTenant?.id) {
                query = query.eq('tenant_id', currentTenant.id);
            }

            const { data, error } = await query;

            if (error) {
                // Try without type filter
                const { data: allData } = await supabase
                    .from('categories')
                    .select('id, name')
                    .is('deleted_at', null)
                    .order('name');
                setCategories(allData || []);
            } else {
                setCategories(data || []);
            }
        } catch (error) {
            console.error('Error fetching categories:', error);
        }
    }, [currentTenant?.id]);

    useEffect(() => {
        fetchCategories();
    }, [fetchCategories]);

    useEffect(() => {
        let cancelled = false;

        const loadTranslation = async () => {
            if (!translationConfig || !item?.id || !currentTenant?.id) {
                setFormData(mapBlogTranslationToFormData(item, null));
                return;
            }

            const { data, error } = await supabase
                .from(translationConfig.tableName || 'content_translations')
                .select('*')
                .eq('content_type', translationConfig.contentType)
                .eq('content_id', item.id)
                .eq('locale', translationConfig.locale)
                .eq('tenant_id', currentTenant.id)
                .maybeSingle();

            if (error) {
                console.error('Error loading blog translation:', error);
                if (!cancelled) {
                    setFormData(mapBlogTranslationToFormData(item, null));
                }
                return;
            }

            if (!cancelled) {
                setFormData(mapBlogTranslationToFormData(item, data));
            }
        };

        loadTranslation();

        return () => {
            cancelled = true;
        };
    }, [translationConfig, item, currentTenant?.id]);

    const handleWorkflowAction = async (newState) => {
        await saveItem(newState);
    };

    const localeBadgeLabel = selectedLanguage === 'en' ? 'EN' : 'ID';
    const effectiveLocaleBadgeLabel = isNewBlog ? 'ID' : localeBadgeLabel;

    const generateSlug = (text) => {
        return text
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '');
    };

    const saveItem = async (workflowStateOverride = null) => {
        if (!canEdit) {
            toast({ variant: 'destructive', title: 'Permission Denied', description: 'You cannot save this blog.' });
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
            const translationSlugValue = (translationConfig && !isNewBlog)
                ? (formData.slug_en || (formData.title_en ? generateSlug(formData.title_en) : ''))
                : '';

            if (translationConfig && translationSlugValue) {
                let translationSlugQuery = supabase
                    .from(translationConfig.tableName || 'content_translations')
                    .select('id')
                    .eq('tenant_id', currentTenant.id)
                    .eq('content_type', translationConfig.contentType)
                    .eq('locale', translationConfig.locale)
                    .eq('slug', translationSlugValue);

                if (item?.id) {
                    translationSlugQuery = translationSlugQuery.neq('content_id', item.id);
                }

                const { data: existingTranslationSlugs, error: translationSlugError } = await translationSlugQuery.limit(1);

                if (translationSlugError) throw translationSlugError;

                if (existingTranslationSlugs && existingTranslationSlugs.length > 0) {
                    const uniqueSuffix = Date.now().toString(36);
                    throw new Error(`Slug "${translationSlugValue}" is already in use for ${translationConfig.locale.toUpperCase()}. Try "${translationSlugValue}-${uniqueSuffix}" instead.`);
                }
            }

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

            const translationFieldMap = translationConfig?.fieldMap || {};
            const translationPayload = Object.entries(translationFieldMap).reduce((acc, [formKey, translationKey]) => {
                const value = formData[formKey];
                acc[translationKey] = typeof value === 'string' ? value.trim() : value ?? null;
                return acc;
            }, {});

            if (translationConfig && !translationPayload.slug && translationSlugValue) {
                translationPayload.slug = translationSlugValue;
            }

            if (!isEditMode) {
                dataToSave.created_by = user.id;
                dataToSave.author_id = user.id;
            }

            let savedItemId = item?.id;

            if (item) {
                delete dataToSave.tenant_id; // Don't update tenant_id
                const { error } = await supabase
                    .from('blogs')
                    .update(dataToSave)
                    .eq('id', item.id);

                if (error) throw error;
                toast({ title: "Success", description: `Blog saved as ${finalWorkflowState}` });
            } else {
                const { data, error } = await supabase
                    .from('blogs')
                    .insert([dataToSave])
                    .select('id')
                    .single();

                if (error) throw error;
                savedItemId = data.id;
                toast({ title: "Success", description: "Blog created successfully" });
            }

            // Sync Tags
            if (savedItemId) {
                await supabase.rpc('sync_resource_tags', {
                    p_resource_id: savedItemId,
                    p_resource_type: 'blogs',
                    p_tags: formData.tags,
                    p_tenant_id: currentTenant.id
                });

                if (translationConfig && !isNewBlog) {
                    const hasTranslationContent = Object.values(translationPayload).some((value) => {
                        if (typeof value === 'string') return value.length > 0;
                        return Boolean(value);
                    });

                    if (hasTranslationContent) {
                        const { error: translationError } = await supabase
                            .from(translationConfig.tableName || 'content_translations')
                            .upsert({
                                content_type: translationConfig.contentType,
                                content_id: savedItemId,
                                locale: translationConfig.locale,
                                tenant_id: currentTenant.id,
                                ...translationPayload,
                            }, {
                                onConflict: 'content_type,content_id,locale,tenant_id'
                            });

                        if (translationError) throw translationError;
                    } else if (isEditMode) {
                        const { error: translationDeleteError } = await supabase
                            .from(translationConfig.tableName || 'content_translations')
                            .delete()
                            .eq('content_type', translationConfig.contentType)
                            .eq('content_id', savedItemId)
                            .eq('locale', translationConfig.locale)
                            .eq('tenant_id', currentTenant.id);

                        if (translationDeleteError) throw translationDeleteError;
                    }
                }
            }

            try {
                await triggerPublicRebuild({
                    tenantId: currentTenant.id,
                    resource: 'blogs',
                    action: item ? 'update' : 'create',
                });
            } catch (rebuildError) {
                console.warn('Public rebuild trigger failed:', rebuildError);
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
            } else if (isEditMode && onSuccess) {
                onSuccess(); // Refresh parent after edit
                onClose();   // Close editor after successful edit
            }

        } catch (error) {
            console.error(error);
            toast({
                variant: "destructive",
                title: "Error",
                description: error.message || "Failed to save blog"
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
                page={item}
                onClose={onClose}
                onSuccess={onSuccess}
                mode="blog" // Custom prop we added support for
                pageId={item?.id} // Helper for mode='blog' logic
                selectedLanguage={selectedLanguage}
            />,
            document.body
        );
    }

    // ... (rest of component logic)

    const renderEditor = () => (
        <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[100] flex flex-col bg-slate-50"
        >
            {/* 1. Blur Overlay Background - Optional visual depth */}
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-50/50 via-white/50 to-blue-50/50 pointer-events-none" />

            {/* 2. Top Navigation / Header */}
            <div className="min-h-16 px-4 py-3 md:px-6 border-b border-slate-200 bg-white flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between shadow-sm z-50">
                <div className="flex min-w-0 items-center gap-3 md:gap-4">
                    <Button variant="ghost" onClick={onClose} className="hover:bg-slate-100/50 gap-2 pr-4 text-slate-600 rounded-full">
                        <ChevronLeft className="w-5 h-5" />
                        <span className="font-medium hidden sm:inline-block">Back</span>
                    </Button>
                    <Separator orientation="vertical" className="hidden md:block h-6" />
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <Input
                                value={formData[activeTitleKey] || ''}
                                onChange={(e) => setFormData(prev => ({
                                    ...prev,
                                    [activeTitleKey]: e.target.value,
                                    [activeSlugKey]: !item
                                        ? generateSlug(e.target.value)
                                        : prev[activeSlugKey],
                                }))}
                                className="border-none shadow-none bg-transparent text-lg font-bold px-0 h-auto focus-visible:ring-0 placeholder:text-slate-400 min-w-0 w-full md:min-w-[300px]"
                                placeholder="Untitled Blog"
                            />
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                            <Badge variant="outline" className={`${getStateColor(currentState)} border px-1.5 py-0 rounded-sm font-normal uppercase tracking-wider text-[10px]`}>
                                {currentState}
                            </Badge>
                            <Badge variant="outline" className="border-primary/20 bg-primary/5 px-1.5 py-0 rounded-sm font-normal uppercase tracking-wider text-[10px] text-primary">
                                {effectiveLocaleBadgeLabel}
                            </Badge>
                            <span>•</span>
                            <span className="truncate max-w-[40vw] md:max-w-[420px]">{formData[activeSlugKey] ? formData[activeSlugKey] : 'slug-placeholder'}</span>
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 lg:justify-end">
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
                                    onClick={() => setVisualSwitchOpen(true)}
                                    className="text-slate-500 hover:text-indigo-600 hidden sm:flex gap-2"
                                >
                                    <Layout className="w-4 h-4" />
                                    <span className="hidden lg:inline">Visual Builder</span>
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Switch to Visual Editor</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>

                    <Separator orientation="vertical" className="hidden xl:block h-6" />

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
                        onClick={() => saveItem(currentState === WORKFLOW_STATES.PUBLISHED ? null : WORKFLOW_STATES.PUBLISHED)}
                        className={cn(
                            'w-full sm:w-auto',
                            currentState === WORKFLOW_STATES.PUBLISHED ? 'bg-slate-900' : 'bg-emerald-600 hover:bg-emerald-700',
                            'text-white shadow-lg shadow-emerald-500/20'
                        )}
                        disabled={loading}
                    >
                        {loading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" /> : (currentState === WORKFLOW_STATES.PUBLISHED ? <Save className="w-4 h-4 mr-2" /> : <Send className="w-4 h-4 mr-2" />)}
                        {isNewBlog ? 'Create Blog' : (currentState === WORKFLOW_STATES.PUBLISHED ? 'Save Changes' : 'Publish')}
                    </Button>
                </div>
            </div>

            {/* 3. Main Workspace - 2 Columns */}
            <div className="flex-1 overflow-hidden">
                <div className="h-full flex flex-col lg:flex-row max-w-[1600px] mx-auto">

                    {/* Left: Main Content (Scrollable) */}
                    <ScrollArea className="flex-1 h-full">
                        <div className="p-5 md:p-8 lg:p-10 xl:p-12 max-w-4xl mx-auto space-y-6 md:space-y-8 pb-32">

                            {/* Featured Image - Banner Style */}
                            <button
                                type="button"
                                onClick={() => setCoverImageOpen(true)}
                                className="group relative block w-full rounded-2xl overflow-hidden bg-slate-100 border border-slate-200 aspect-video max-h-[300px] text-left hover:shadow-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                            >
                                {formData.featured_image ? (
                                    <img src={formData.featured_image} alt="Cover" className="w-full h-full object-cover" />
                                ) : (
                                    <div className="flex flex-col items-center justify-center h-full text-slate-400">
                                        <ImageIcon className="w-10 h-10 mb-2 opacity-50" />
                                        <span className="text-sm font-medium">Add Cover Image</span>
                                    </div>
                                )}
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                                    <div className="rounded-full border border-white/60 bg-white/95 px-4 py-2 text-sm font-medium text-slate-700 shadow-sm backdrop-blur">
                                        {formData.featured_image ? 'Change Cover' : 'Add Cover Image'}
                                    </div>
                                </div>
                            </button>

                            {/* Excerpt */}
                            <div className="space-y-2">
                                <Label className="text-slate-500 uppercase tracking-widest text-[11px] font-semibold pl-1">Introduction / Excerpt</Label>
                                <Textarea
                                    value={formData[activeExcerptKey] || ''}
                                    onChange={(e) => setFormData(p => ({ ...p, [activeExcerptKey]: e.target.value }))}
                                    className="bg-transparent border-none focus-visible:ring-0 px-0 text-lg text-slate-600 resize-none min-h-[80px] placeholder:text-slate-300"
                                    placeholder="Add a short introduction..."
                                />
                            </div>

                            <Separator className="bg-slate-100" />

                            {/* Rich Editor */}
                            <div className="min-h-[500px]">
                                <RichTextEditor
                                    value={formData[activeContentKey] || ''}
                                    onChange={(val) => setFormData(p => ({ ...p, [activeContentKey]: val }))}
                                    placeholder="Tell your story..."
                                    className="prose-lg max-w-none"
                                />
                            </div>
                        </div>
                    </ScrollArea>

                    {/* Right: Sidebar (Settings) - Solid */}
                    <div className={`w-full lg:w-[360px] xl:w-[380px] border-l border-slate-200 bg-slate-50 h-full overflow-y-auto ${showMobileSettings ? 'fixed inset-0 z-[110] bg-white' : 'hidden lg:block'}`}>
                        {/* Mobile Sidebar Header */}
                        {showMobileSettings && (
                            <div className="flex items-center justify-between p-4 border-b lg:hidden">
                                <span className="font-semibold">Blog Settings</span>
                                <Button variant="ghost" size="icon" onClick={() => setShowMobileSettings(false)}>
                                    <X className="w-5 h-5" />
                                </Button>
                            </div>
                        )}
                        <div className="p-4 md:p-5 space-y-6">



                            {/* Organization */}
                            <div className="space-y-4">
                                <h4 className="flex items-center gap-2 font-semibold text-slate-800 text-sm">
                                    <FolderOpen className="w-4 h-4 text-indigo-500" /> Organization
                                </h4>
                                <div className="space-y-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                                    <div className="space-y-2">
                                        <Label className="text-slate-500 uppercase tracking-widest text-[11px] font-semibold pl-1">Category</Label>
                                        <Select
                                            value={formData.category_id}
                                            onValueChange={(val) => setFormData({ ...formData, category_id: val })}
                                        >
                                            <SelectTrigger className="w-full bg-white border-slate-200">
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
                                <div className="space-y-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
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
                                            value={formData[activeMetaDescriptionKey] || ''}
                                            onChange={(e) => setFormData(p => ({ ...p, [activeMetaDescriptionKey]: e.target.value }))}
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
                                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-4">
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

                            <div className="sticky bottom-0 -mx-4 md:-mx-5 mt-2 border-t border-slate-200 bg-slate-50/95 px-4 md:px-5 py-3 text-xs text-slate-400 text-center backdrop-blur supports-[backdrop-filter]:bg-slate-50/80">
                                {loading ? 'Saving changes...' : 'Ready to save'}
                            </div>

                        </div>
                    </div>
                </div>
            </div>

            <Dialog open={coverImageOpen} onOpenChange={setCoverImageOpen}>
                <DialogContent className="max-w-3xl border-slate-200 bg-white p-0 shadow-2xl">
                    <DialogHeader className="border-b border-slate-200 px-6 py-5">
                        <DialogTitle>Cover Image</DialogTitle>
                        <DialogDescription>
                            Upload a hero image, choose one from the media library, or paste an external image URL.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
                        <ImageUpload
                            value={formData.featured_image}
                            onChange={(url) => setFormData(prev => ({ ...prev, featured_image: url }))}
                        />
                    </div>
                    <DialogFooter className="border-t border-slate-200 px-6 py-4">
                        {formData.featured_image ? (
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => setFormData(prev => ({ ...prev, featured_image: '' }))}
                            >
                                Remove Image
                            </Button>
                        ) : <div />}
                        <Button type="button" onClick={() => setCoverImageOpen(false)} className="bg-slate-900 hover:bg-slate-800 text-white">
                            Done
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AlertDialog open={visualSwitchOpen} onOpenChange={setVisualSwitchOpen}>
                <AlertDialogContent className="border-slate-200 bg-white shadow-2xl">
                    <AlertDialogHeader>
                        <AlertDialogTitle>Switch to Visual Builder?</AlertDialogTitle>
                        <AlertDialogDescription className="space-y-2">
                            <span className="block">Use the visual builder when you want layout-driven storytelling blocks instead of the standard rich text editor.</span>
                            <span className="block">Existing text content may need light cleanup after the switch, especially on older posts.</span>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => {
                                setUseVisualBuilder(true);
                                setVisualSwitchOpen(false);
                            }}
                            className="bg-indigo-600 hover:bg-indigo-700"
                        >
                            Switch
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </motion.div>
    );

    return createPortal(renderEditor(), document.body);
}

export default BlogEditor;
