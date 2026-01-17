
import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Save, X, Globe, Calendar, Lock, Layout, Share2, FolderOpen } from 'lucide-react';
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

function PageEditor({ page, onClose, onSuccess }) {
    const { toast } = useToast();
    const { user } = useAuth();
    const { currentTenant } = useTenant(); // Get Current Tenant
    const { hasPermission } = usePermissions();
    const [loading, setLoading] = useState(false);
    const [categories, setCategories] = useState([]);

    const [formData, setFormData] = useState({
        title: page?.title || '',
        slug: page?.slug || '',
        content: page?.content || '',
        excerpt: page?.excerpt || '',
        featured_image: page?.featured_image || '',
        status: page?.status || 'draft',
        is_public: page?.is_public ?? false,
        category_id: page?.category_id || '',
        tags: page?.tags || [],

        // SEO
        meta_title: page?.meta_title || '',
        meta_description: page?.meta_description || '',
        meta_keywords: page?.meta_keywords || '',
        canonical_url: page?.canonical_url || '',
        robots: page?.robots || 'index, follow',

        // Social
        og_title: page?.og_title || '',
        og_description: page?.og_description || '',
        og_image: page?.og_image || '',
        twitter_card_type: page?.twitter_card_type || 'summary',
        twitter_image: page?.twitter_image || '',

        published_at: page?.published_at ? new Date(page.published_at).toISOString().slice(0, 16) : '',
        layout_key: page?.layout_key || 'awtemplate01.standard',
        content_type: page?.content_type || 'richtext',
        // Hierarchy & Nav
        parent_id: page?.parent_id || '',
        template_key: page?.template_key || 'awtemplate01',
        sort_order: page?.sort_order || 0,
        nav_visibility: page?.nav_visibility ?? true
    });

    const isEditMode = !!page;

    // Permissions
    const canEdit = hasPermission('tenant.pages.update') || (user?.id === page?.created_by);
    const canPublish = hasPermission('tenant.pages.publish');

    const [parentPages, setParentPages] = useState([]);

    useEffect(() => {
        const fetchData = async () => {
            try {
                // Fetch Categories
                let catQuery = supabase.from('categories').select('id, name').eq('type', 'page');
                if (currentTenant?.id) catQuery = catQuery.eq('tenant_id', currentTenant.id);
                const { data: catData } = await catQuery;
                setCategories(catData || []);

                // Fetch Potential Parent Pages (exclude current page if editing)
                let pageQuery = supabase.from('pages').select('id, title, slug').eq('tenant_id', currentTenant?.id);
                if (page?.id) pageQuery = pageQuery.neq('id', page.id);
                const { data: pageData } = await pageQuery;
                setParentPages(pageData || []);
            } catch (e) { console.error(e); }
        };
        fetchData();
    }, [currentTenant?.id, page?.id]);

    const generateSlug = (text) => {
        return text
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '');
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!canEdit) return;

        if (!currentTenant?.id) {
            toast({ variant: 'destructive', title: 'System Error', description: 'No active tenant context found.' });
            return;
        }

        // Publish Check
        if (formData.status === 'published' && !canPublish) {
            toast({ variant: 'warning', title: 'Publish Restricted', description: 'Saved as draft (permission required).' });
            setFormData(prev => ({ ...prev, status: 'draft' }));
            // We continue saving as draft
        }

        setLoading(true);
        try {
            const payload = {
                tenant_id: currentTenant.id, // Explicit Tenant ID
                title: formData.title,
                slug: formData.slug || generateSlug(formData.title),
                content: formData.content,
                excerpt: formData.excerpt,
                featured_image: formData.featured_image,
                status: (formData.status === 'published' && !canPublish) ? 'draft' : formData.status,
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
                is_public: formData.is_public,

                layout_key: formData.layout_key,
                content_type: formData.content_type,
                parent_id: formData.parent_id || null, // Handle empty string as null
                template_key: formData.template_key,
                sort_order: parseInt(formData.sort_order),
                nav_visibility: formData.nav_visibility,
                updated_at: new Date().toISOString()
            };

            if (!isEditMode) {
                payload.created_by = user.id;
            }

            let savedId = page?.id;

            if (page) {
                // Keep existing tenant_id safe
                delete payload.tenant_id;
                const { error } = await supabase.from('pages').update(payload).eq('id', page.id);
                if (error) throw error;
            } else {
                const { data, error } = await supabase.from('pages').insert([payload]).select('id').single();
                if (error) throw error;
                savedId = data.id;
            }

            // Sync Tags
            if (savedId) {
                await supabase.rpc('sync_resource_tags', {
                    p_resource_id: savedId,
                    p_resource_type: 'pages',
                    p_tags: formData.tags,
                    p_tenant_id: currentTenant.id // Explicit Tenant ID for tags
                });
            }

            toast({ title: "Success", description: "Page saved successfully" });
            onSuccess?.();
            onClose();
        } catch (error) {
            console.error(error);
            toast({ variant: "destructive", title: "Error", description: error.message });
        } finally {
            setLoading(false);
        }
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
                        {page ? 'Edit Page' : 'New Page'}
                        {page?.status === 'published' && <span className="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full border border-green-200">Live</span>}
                    </h3>
                    <div className="text-xs text-slate-500 mt-1 flex items-center gap-2">
                        {page?.created_by ? (
                            <span className="flex items-center gap-1"><Lock className="w-3 h-3" /> Owner: {user?.id === page.created_by ? 'You' : 'Others'}</span>
                        ) : (
                            <span>Author: You</span>
                        )}
                    </div>
                </div>

                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => {
                        const baseUrl = import.meta.env.VITE_PUBLIC_PORTAL_URL || 'http://localhost:4321';
                        const previewSecret = import.meta.env.VITE_PREVIEW_SECRET || '';
                        const url = previewSecret
                            ? `${baseUrl}/${formData.slug}?preview_secret=${previewSecret}`
                            : `${baseUrl}/${formData.slug}`;
                        window.open(url, '_blank');
                    }}>
                        <Globe className="w-4 h-4 mr-2" /> Preview
                    </Button>
                    <Button type="button" onClick={handleSubmit} disabled={loading} className="bg-slate-900 hover:bg-slate-800 text-white">
                        <Save className="w-4 h-4 mr-2" />
                        {loading ? 'Saving...' : 'Save Page'}
                    </Button>
                    <Button variant="ghost" size="icon" onClick={onClose}>
                        <X className="w-5 h-5" />
                    </Button>
                </div>
            </div >

            <form onSubmit={handleSubmit} className="flex-1 overflow-hidden flex flex-col">
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
                                            <Label htmlFor="title">Page Title <span className="text-red-500">*</span></Label>
                                            <Input
                                                id="title"
                                                value={formData.title}
                                                onChange={(e) => {
                                                    setFormData({
                                                        ...formData,
                                                        title: e.target.value,
                                                        slug: !page ? generateSlug(e.target.value) : formData.slug
                                                    });
                                                }}
                                                className="text-lg font-semibold"
                                                placeholder="Enter page title"
                                                required
                                            />
                                        </div>

                                        <div className="space-y-2">
                                            <Label htmlFor="slug" className="text-xs text-slate-500">Permalink</Label>
                                            <div className="flex items-center gap-0">
                                                <span className="text-xs text-slate-500 bg-slate-50 px-3 py-2 rounded-l-md border border-r-0 border-slate-300">/pages/</span>
                                                <Input
                                                    id="slug"
                                                    value={formData.slug}
                                                    onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                                                    className="rounded-l-none font-mono text-sm"
                                                    required
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-4 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                                        <div className="space-y-2">
                                            <Label htmlFor="layout_key">Page Layout</Label>
                                            <select
                                                id="layout_key"
                                                value={formData.layout_key}
                                                onChange={(e) => setFormData({ ...formData, layout_key: e.target.value })}
                                                className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600"
                                            >
                                                <option value="awtemplate01.standard">Standard Layout (with Title)</option>
                                                <option value="awtemplate01.landing">Landing Page (Full Width)</option>
                                            </select>
                                        </div>
                                    </div>

                                    <div className="space-y-2 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                                        <Label htmlFor="content">Content <span className="text-red-500">*</span></Label>
                                        <RichTextEditor
                                            value={formData.content}
                                            onChange={(val) => setFormData({ ...formData, content: val })}
                                            placeholder="Start designing your page..."
                                        />
                                    </div>

                                    <div className="space-y-2 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                                        <Label htmlFor="excerpt">Excerpt</Label>
                                        <Textarea
                                            id="excerpt"
                                            value={formData.excerpt}
                                            onChange={(e) => setFormData({ ...formData, excerpt: e.target.value })}
                                            placeholder="Brief summary of the page content..."
                                        />
                                        <p className="text-xs text-slate-400">Used for search results and previews.</p>
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
                                        placeholder="page, content, info..."
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
                                            className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600"
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
                                                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                                                className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600"
                                            >
                                                <option value="draft">Draft</option>
                                                <option value="published" disabled={!canPublish}>Published {(!canPublish) && '(Locked)'}</option>
                                                <option value="archived">Archived</option>
                                            </select>
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

                                        <div className="flex items-center gap-2 pt-1">
                                            <input
                                                type="checkbox"
                                                id="nav_visibility"
                                                checked={formData.nav_visibility}
                                                onChange={(e) => setFormData({ ...formData, nav_visibility: e.target.checked })}
                                                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                                            />
                                            <Label htmlFor="nav_visibility" className="font-normal text-slate-700 cursor-pointer">Show in Menu</Label>
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
                                    <FolderOpen className="w-4 h-4 text-blue-600" /> Categorization & Hierarchy
                                </h4>

                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                                    <div className="space-y-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="parent_id">Parent Page</Label>
                                            <select
                                                id="parent_id"
                                                value={formData.parent_id}
                                                onChange={(e) => setFormData({ ...formData, parent_id: e.target.value })}
                                                className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600"
                                            >
                                                <option value="">No Parent (Top Level)</option>
                                                {parentPages.map(p => (
                                                    <option key={p.id} value={p.id}>{p.title} (/{p.slug})</option>
                                                ))}
                                            </select>
                                        </div>

                                        <div className="space-y-2">
                                            <Label htmlFor="sort_order">Sort Order</Label>
                                            <Input
                                                id="sort_order"
                                                type="number"
                                                value={formData.sort_order}
                                                onChange={(e) => setFormData({ ...formData, sort_order: e.target.value })}
                                                placeholder="0"
                                            />
                                            <p className="text-xs text-slate-500">Higher numbers appear later in menus.</p>
                                        </div>
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
                                                className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600"
                                                required
                                            >
                                                <option value="">Select Category</option>
                                                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                            </select>
                                        </div>

                                        <div className="space-y-2">
                                            <Label htmlFor="tags">Tags</Label>
                                            <TagInput
                                                value={formData.tags}
                                                onChange={(val) => setFormData({ ...formData, tags: val })}
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
                                                    className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600"
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
            </form >
        </motion.div >
    );
}

export default PageEditor;
