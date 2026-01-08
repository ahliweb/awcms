
import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Save, X, Globe, Calendar, Lock, Layout, Image as ImageIcon, Share2, FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { usePermissions } from '@/contexts/PermissionContext';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ImageUpload } from '@/components/ui/ImageUpload';
import RichTextEditor from '@/components/ui/RichTextEditor';
import TagInput from '@/components/ui/TagInput';

function ArticleEditor({ article, onClose, onSuccess }) {
    const { toast } = useToast();
    const { user } = useAuth();
    const { currentTenant } = useTenant(); // Get Current Tenant
    const { hasPermission, userRole } = usePermissions();
    const [loading, setLoading] = useState(false);
    const [categories, setCategories] = useState([]);
    const [currentState, setCurrentState] = useState(article?.workflow_state || 'draft');

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
    }, []);

    const fetchCategories = async () => {
        try {
            // Fetch categories for articles
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
            // Non-critical, just log
        }
    };

    const canTransition = (targetState) => {
        if (!isEditMode) return false; // Simple logic for now
        // Implement complex workflow transition guards here if needed
        return true;
    };

    // Handle Workflow Action
    const handleWorkflowAction = async (newState) => {
        await saveArticle(newState);
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

        // Determine final states
        const finalWorkflowState = workflowStateOverride || currentState;
        let finalStatus = formData.status;

        // Workflow side-effects
        if (workflowStateOverride === WORKFLOW_STATES.PUBLISHED) {
            finalStatus = 'published';
        } else if (workflowStateOverride === WORKFLOW_STATES.DRAFT) {
            finalStatus = 'draft';
        }

        // Validate Publish Permission for explicit published status
        if (finalStatus === 'published' && !canPublish) {
            toast({ variant: 'destructive', title: 'Publishing Restricted', description: 'You do not have permission to publish. Saved as draft.' });
            finalStatus = 'draft';
        }

        setLoading(true);

        try {
            const dataToSave = {
                tenant_id: currentTenant.id, // Explicitly set Tenant ID
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
                // Ensure we don't accidentally move tenants (though RLS prevents it)
                delete dataToSave.tenant_id;

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
                    p_tenant_id: currentTenant.id // Explicit Tenant ID for tags
                });
            }

            // Update Local State
            if (workflowStateOverride) {
                setCurrentState(workflowStateOverride);
            }
            // Update form status if changed by workflow
            if (finalStatus !== formData.status) {
                setFormData(prev => ({ ...prev, status: finalStatus }));
            }

            if (!isEditMode && onSuccess) {
                onSuccess(); // Maybe redirect or reload
                onClose();
            } else if (onSuccess) {
                // Optional: refresh parent
            }

            // Note: We don't close automatically on save unless it's new, allowing continued editing.
            // But if user clicked "Close" or "Approve" maybe we should close? 
            // Usually editors stay open.

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

    const generateSlug = (text) => {
        return text
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '');
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-xl shadow-md p-0 flex flex-col h-full overflow-hidden"
        >
            <div className="flex justify-between items-center px-6 py-4 border-b border-slate-100 bg-slate-50/50">
                <div>
                    <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                        {article ? 'Edit Article' : 'New Article'}
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${currentState === WORKFLOW_STATES.PUBLISHED ? 'bg-green-100 text-green-700 border-green-200' :
                            currentState === WORKFLOW_STATES.APPROVED ? 'bg-blue-100 text-blue-700 border-blue-200' :
                                currentState === WORKFLOW_STATES.REVIEWED ? 'bg-yellow-100 text-yellow-700 border-yellow-200' :
                                    'bg-slate-100 text-slate-700 border-slate-200'
                            }`}>
                            {currentState.toUpperCase()}
                        </span>
                    </h3>
                    <div className="text-xs text-slate-500 mt-1 flex items-center gap-2">
                        {article?.author_id ? (
                            <span className="flex items-center gap-1"><Lock className="w-3 h-3" /> Owner: {user?.id === article.author_id ? 'You' : 'Others'}</span>
                        ) : (
                            <span>Author: You</span>
                        )}
                    </div>
                </div>
                <div className="flex gap-2">
                    {/* Workflow Buttons */}
                    {isEditMode && currentState === WORKFLOW_STATES.DRAFT && canTransition(WORKFLOW_STATES.REVIEWED) && (
                        <Button onClick={() => handleWorkflowAction(WORKFLOW_STATES.REVIEWED)} variant="secondary" size="sm" className="bg-yellow-50 text-yellow-700 border border-yellow-200 hover:bg-yellow-100">
                            Submit for Review
                        </Button>
                    )}
                    {isEditMode && currentState === WORKFLOW_STATES.REVIEWED && canTransition(WORKFLOW_STATES.APPROVED) && (
                        <>
                            <Button onClick={() => handleWorkflowAction(WORKFLOW_STATES.DRAFT)} variant="outline" size="sm" className="text-red-600 border-red-200 hover:bg-red-50 mr-2">
                                Request Changes
                            </Button>
                            <Button onClick={() => handleWorkflowAction(WORKFLOW_STATES.APPROVED)} variant="secondary" size="sm" className="bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100">
                                Approve
                            </Button>
                        </>
                    )}
                    {isEditMode && (currentState === WORKFLOW_STATES.APPROVED || currentState === WORKFLOW_STATES.DRAFT) && canTransition(WORKFLOW_STATES.PUBLISHED) && (
                        <Button onClick={() => handleWorkflowAction(WORKFLOW_STATES.PUBLISHED)} variant="secondary" size="sm" className="bg-green-50 text-green-700 border border-green-200 hover:bg-green-100">
                            Publish Now
                        </Button>
                    )}

                    <Button type="button" onClick={() => saveArticle()} disabled={loading} className="bg-slate-900 hover:bg-slate-800 text-white">
                        <Save className="w-4 h-4 mr-2" />
                        {loading ? 'Saving...' : 'Save Draft'}
                    </Button>
                    <Button variant="ghost" size="icon" onClick={onClose}>
                        <X className="w-5 h-5" />
                    </Button>
                </div>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); saveArticle(); }} className="flex-1 overflow-hidden flex flex-col">
                <div className="flex-1 overflow-y-auto p-6 bg-slate-50/30">
                    <Tabs defaultValue="content" className="w-full h-full flex flex-col">
                        <TabsList className="grid w-full grid-cols-4 mb-6 bg-slate-100 p-1 rounded-lg">
                            <TabsTrigger value="content" className="flex items-center gap-2 data-[state=active]:bg-white data-[state=active]:shadow-sm transition-all duration-200">
                                <Layout className="w-4 h-4" /> Content
                            </TabsTrigger>
                            <TabsTrigger value="seo" className="flex items-center gap-2 data-[state=active]:bg-white data-[state=active]:shadow-sm transition-all duration-200">
                                <Globe className="w-4 h-4" /> SEO & Meta
                            </TabsTrigger>
                            <TabsTrigger value="organization" className="flex items-center gap-2 data-[state=active]:bg-white data-[state=active]:shadow-sm transition-all duration-200">
                                <FolderOpen className="w-4 h-4" /> Organization
                            </TabsTrigger>
                            <TabsTrigger value="social" className="flex items-center gap-2 data-[state=active]:bg-white data-[state=active]:shadow-sm transition-all duration-200">
                                <Share2 className="w-4 h-4" /> Social Media
                            </TabsTrigger>
                        </TabsList>

                        {/* Content Tab */}
                        <TabsContent value="content" className="space-y-6 animate-in fade-in zoom-in-95 duration-200">
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                <div className="lg:col-span-3 space-y-6">
                                    <div className="space-y-4 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                                        <div className="space-y-2">
                                            <Label htmlFor="title">Title <span className="text-red-500">*</span></Label>
                                            <Input
                                                id="title"
                                                value={formData.title}
                                                onChange={(e) => {
                                                    setFormData({
                                                        ...formData,
                                                        title: e.target.value,
                                                        slug: !article ? generateSlug(e.target.value) : formData.slug
                                                    });
                                                }}
                                                className="text-lg font-semibold"
                                                placeholder="Enter article title"
                                                required
                                            />
                                        </div>

                                        <div className="space-y-2">
                                            <Label htmlFor="slug" className="text-xs text-slate-500">Permalink</Label>
                                            <div className="flex items-center gap-0">
                                                <span className="text-xs text-slate-500 bg-slate-50 px-3 py-2 rounded-l-md border border-r-0 border-slate-300">/articles/</span>
                                                <Input
                                                    id="slug"
                                                    value={formData.slug}
                                                    onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                                                    required
                                                    className="rounded-l-none font-mono text-sm"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-2 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                                        <Label htmlFor="content">Content <span className="text-red-500">*</span></Label>
                                        <RichTextEditor
                                            value={formData.content}
                                            onChange={(content) => setFormData({ ...formData, content })}
                                            placeholder="Write something amazing..."
                                        />
                                    </div>

                                    <div className="space-y-2 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                                        <Label htmlFor="excerpt">Excerpt</Label>
                                        <Textarea
                                            id="excerpt"
                                            value={formData.excerpt}
                                            onChange={(e) => setFormData({ ...formData, excerpt: e.target.value })}
                                            placeholder="Short summary for search results and lists..."
                                        />
                                        <p className="text-xs text-slate-400">Brief description used in lists and search results.</p>
                                    </div>
                                </div>
                            </div>
                        </TabsContent>

                        {/* SEO & Meta Tab */}
                        <TabsContent value="seo" className="space-y-8 animate-in fade-in zoom-in-95 duration-200">
                            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-6">
                                <h4 className="font-semibold text-slate-800 flex items-center gap-2 text-base border-b border-slate-100 pb-3">
                                    <Globe className="w-4 h-4 text-blue-600" /> Search Engine Optimization
                                </h4>

                                <div className="space-y-2">
                                    <Label htmlFor="meta_title">Meta Title</Label>
                                    <Input
                                        id="meta_title"
                                        value={formData.meta_title}
                                        onChange={(e) => setFormData({ ...formData, meta_title: e.target.value })}
                                        placeholder={formData.title}
                                    />
                                    <p className="text-xs text-slate-500">Recommended length: 50-60 characters</p>
                                </div>

                                <div className="space-y-2">
                                    <div className="flex justify-between items-center">
                                        <Label htmlFor="meta_description">Meta Description</Label>
                                        <span className={`text-xs font-medium ${formData.meta_description.length > 160 ? 'text-red-500' : 'text-slate-400'}`}>
                                            {formData.meta_description.length}/160
                                        </span>
                                    </div>
                                    <Textarea
                                        id="meta_description"
                                        value={formData.meta_description}
                                        onChange={(e) => setFormData({ ...formData, meta_description: e.target.value })}
                                        className={`min-h-[100px] ${formData.meta_description.length > 160 ? 'border-red-300 focus-visible:ring-red-200' : ''}`}
                                        placeholder="Enter a concise description for search engines..."
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="meta_keywords">Keywords (Comma separated)</Label>
                                    <Input
                                        id="meta_keywords"
                                        value={formData.meta_keywords}
                                        onChange={(e) => setFormData({ ...formData, meta_keywords: e.target.value })}
                                        placeholder="cms, web, design..."
                                    />
                                </div>
                            </div>

                            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-6">
                                <h4 className="font-semibold text-slate-800 text-base border-b border-slate-100 pb-3">Advanced SEO</h4>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="space-y-2">
                                        <Label htmlFor="canonical_url">Canonical URL</Label>
                                        <Input
                                            id="canonical_url"
                                            value={formData.canonical_url}
                                            onChange={(e) => setFormData({ ...formData, canonical_url: e.target.value })}
                                            placeholder="https://..."
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="robots">Robots Meta</Label>
                                        <select
                                            id="robots"
                                            value={formData.robots}
                                            onChange={(e) => setFormData({ ...formData, robots: e.target.value })}
                                            className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        >
                                            <option value="index, follow">Index, Follow (Default)</option>
                                            <option value="noindex, follow">NoIndex, Follow</option>
                                            <option value="index, nofollow">Index, NoFollow</option>
                                            <option value="noindex, nofollow">NoIndex, NoFollow</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                        </TabsContent>

                        {/* Organization Tab */}
                        <TabsContent value="organization" className="space-y-6 animate-in fade-in zoom-in-95 duration-200">
                            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-6">
                                <h4 className="font-semibold text-slate-800 flex items-center gap-2 text-base border-b border-slate-100 pb-3">
                                    <Calendar className="w-4 h-4 text-blue-600" /> Publishing & Visibility
                                </h4>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                    <div className="space-y-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="status">Publish Status</Label>
                                            <select
                                                id="status"
                                                value={formData.status}
                                                disabled={true}
                                                className="flex h-10 w-full rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-70 disabled:cursor-not-allowed"
                                            >
                                                <option value="draft">Draft</option>
                                                <option value="published">Published</option>
                                                <option value="archived">Archived</option>
                                            </select>
                                            <p className="text-xs text-slate-500 mt-1">Status is managed via the Workflow buttons above.</p>
                                        </div>

                                        <div className="flex items-center gap-2 pt-1">
                                            <input
                                                type="checkbox"
                                                id="is_public"
                                                checked={formData.is_public}
                                                onChange={(e) => setFormData({ ...formData, is_public: e.target.checked })}
                                                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                                            />
                                            <Label htmlFor="is_public" className="font-normal text-slate-700 cursor-pointer">Publicly Visible</Label>
                                        </div>

                                        <div className="space-y-2 pt-2">
                                            <Label htmlFor="published_at">Publish Date (Schedule)</Label>
                                            <Input
                                                type="datetime-local"
                                                id="published_at"
                                                value={formData.published_at}
                                                onChange={(e) => setFormData({ ...formData, published_at: e.target.value })}
                                                className="w-full"
                                            />
                                            <p className="text-xs text-slate-500">Leave blank to publish immediately.</p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-6">
                                <h4 className="font-semibold text-slate-800 flex items-center gap-2 text-base border-b border-slate-100 pb-3">
                                    <FolderOpen className="w-4 h-4 text-blue-600" /> Categorization
                                </h4>

                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                                    <div className="space-y-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="featured_image">Featured Image</Label>
                                            <ImageUpload
                                                value={formData.featured_image}
                                                onChange={(url) => setFormData({ ...formData, featured_image: url })}
                                                className="h-48"
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="category">Category <span className="text-red-500">*</span></Label>
                                            <select
                                                id="category"
                                                value={formData.category_id}
                                                onChange={(e) => setFormData({ ...formData, category_id: e.target.value })}
                                                className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                required
                                            >
                                                <option value="">Select Category</option>
                                                {categories.map(cat => (
                                                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                                                ))}
                                            </select>
                                        </div>

                                        <div className="space-y-2">
                                            <Label htmlFor="tags">Tags</Label>
                                            <TagInput
                                                value={formData.tags}
                                                onChange={(newTags) => setFormData({ ...formData, tags: newTags })}
                                                placeholder="Add tags..."
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </TabsContent>

                        {/* Social Media Sharing Tab */}
                        <TabsContent value="social" className="space-y-6 animate-in fade-in zoom-in-95 duration-200">
                            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-6">
                                <h4 className="font-semibold text-slate-800 flex items-center gap-2 text-base border-b border-slate-100 pb-3">
                                    <Share2 className="w-4 h-4 text-blue-600" /> Social Media Settings
                                </h4>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                    {/* Open Graph */}
                                    <div className="space-y-4">
                                        <Label className="text-blue-600 font-semibold block mb-4">Open Graph (Facebook, LinkedIn)</Label>
                                        <div className="space-y-4 pl-4 border-l-2 border-blue-100">
                                            <div className="space-y-2">
                                                <Label>OG Title</Label>
                                                <Input
                                                    value={formData.og_title}
                                                    onChange={(e) => setFormData({ ...formData, og_title: e.target.value })}
                                                    placeholder={formData.title}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label>OG Description</Label>
                                                <Textarea
                                                    value={formData.og_description}
                                                    onChange={(e) => setFormData({ ...formData, og_description: e.target.value })}
                                                    placeholder={formData.excerpt}
                                                    className="min-h-[80px]"
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label>OG Image</Label>
                                                <ImageUpload
                                                    value={formData.og_image}
                                                    onChange={(url) => setFormData({ ...formData, og_image: url })}
                                                    className="h-32"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Twitter Card */}
                                    <div className="space-y-4">
                                        <Label className="text-sky-500 font-semibold block mb-4">Twitter Card</Label>
                                        <div className="space-y-4 pl-4 border-l-2 border-sky-100">
                                            <div className="space-y-2">
                                                <Label>Card Type</Label>
                                                <select
                                                    value={formData.twitter_card_type}
                                                    onChange={(e) => setFormData({ ...formData, twitter_card_type: e.target.value })}
                                                    className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                                                >
                                                    <option value="summary">Summary</option>
                                                    <option value="summary_large_image">Summary Large Image</option>
                                                </select>
                                            </div>
                                            <div className="space-y-2">
                                                <Label>Twitter Image</Label>
                                                <ImageUpload
                                                    value={formData.twitter_image}
                                                    onChange={(url) => setFormData({ ...formData, twitter_image: url })}
                                                    className="h-32"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </TabsContent>
                    </Tabs>
                </div>
            </form>
        </motion.div>
    );
}

export default ArticleEditor;
