
import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/customSupabaseClient';
import { motion } from 'framer-motion';
import { Calendar, ArrowLeft, Share2, Printer, User, Eye, Tag, ChevronRight, Home, FileText } from 'lucide-react';
import SeoHelmet from '@/components/public/SeoHelmet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import ShareButtons from '@/components/public/ShareButtons';
import TableOfContents from '@/components/public/TableOfContents';
import { useTranslation } from 'react-i18next';
import { Render } from '@puckeditor/core';
import puckConfig from '@/components/visual-builder/config';
import '@puckeditor/core/puck.css';
import '@/components/visual-builder/puck-theme.css';
import { WidgetAreaRenderer } from '@/components/public/WidgetAreaRenderer';
import { sanitizeHTML } from '@/utils/sanitize';

function PublicPageDetail() {
    const { slug } = useParams();
    const navigate = useNavigate();
    const { t } = useTranslation();

    const [page, setPage] = useState(null);
    const [loading, setLoading] = useState(true);
    const [relatedPages, setRelatedPages] = useState([]);

    useEffect(() => {
        const fetchDetail = async () => {
            setLoading(true);
            try {
                // Fetch main page
                // Explicitly use the foreign key relationship name to resolve ambiguity
                const { data, error } = await supabase
                    .from('pages')
                    .select(`
                *, 
                categories!pages_category_id_fkey(id, name), 
                users!created_by(full_name, avatar_url)
            `)
                    .eq('slug', slug)
                    .eq('status', 'published')
                    .eq('is_public', true)
                    .maybeSingle();

                if (error) throw error;

                if (data) {
                    setPage(data);

                    // Increment view count via RPC
                    supabase.rpc('increment_page_view', { page_id: data.id });

                    // Fetch related pages in same category
                    if (data.category_id) {
                        const { data: related } = await supabase
                            .from('pages')
                            .select('id, title, slug, created_at, featured_image')
                            .eq('category_id', data.category_id)
                            .neq('id', data.id)
                            .eq('status', 'published')
                            .eq('is_public', true)
                            .limit(4);
                        setRelatedPages(related || []);
                    }
                }
            } catch (err) {
                console.error("Page detail error:", err);
            } finally {
                setLoading(false);
            }
        };
        fetchDetail();
    }, [slug]);

    const handlePrint = () => {
        window.print();
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-white">
                <div className="h-96 bg-slate-100 w-full animate-pulse"></div>
                <div className="container mx-auto px-4 max-w-7xl grid grid-cols-1 lg:grid-cols-12 gap-12 -mt-20 relative z-10">
                    <div className="lg:col-span-8 bg-white p-8 rounded-t-3xl border border-slate-200 shadow-sm space-y-6">
                        <div className="h-4 bg-slate-200 rounded w-1/4"></div>
                        <div className="h-10 bg-slate-200 rounded w-3/4"></div>
                        <div className="space-y-4 pt-8">
                            <div className="h-4 bg-slate-200 rounded w-full"></div>
                            <div className="h-4 bg-slate-200 rounded w-full"></div>
                            <div className="h-4 bg-slate-200 rounded w-2/3"></div>
                        </div>
                    </div>
                    <div className="lg:col-span-4 hidden lg:block pt-20 space-y-6">
                        <div className="h-64 bg-slate-100 rounded-xl"></div>
                    </div>
                </div>
            </div>
        );
    }

    if (!page) return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 px-4 text-center">
            <SeoHelmet title="Page Not Found" />
            <div className="bg-white p-12 rounded-3xl shadow-xl border border-slate-100 max-w-lg">
                <div className="w-20 h-20 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-6">
                    <FileText className="w-10 h-10" />
                </div>
                <h2 className="text-3xl font-bold text-slate-900 mb-3">{t('Page Not Found')}</h2>
                <p className="text-slate-600 mb-8 text-lg">{t('The page you are looking for might have been removed, had its name changed, or is temporarily unavailable.')}</p>
                <div className="flex justify-center gap-4">
                    <Button onClick={() => navigate(-1)} variant="outline">
                        <ArrowLeft className="w-4 h-4 mr-2" /> {t('Go Back')}
                    </Button>
                    <Button onClick={() => navigate('/pages')} className="bg-blue-600 hover:bg-blue-700">
                        {t('Browse Pages')}
                    </Button>
                </div>
            </div>
        </div>
    );

    const currentUrl = typeof window !== 'undefined' ? window.location.href : '';

    return (
        <div className="bg-slate-50 min-h-screen pb-20 font-sans">
            <SeoHelmet
                type="article"
                id={page.id}
                title={page.meta_title || page.title}
                description={page.meta_description || page.excerpt}
                keywords={page.meta_keywords}
                image={page.og_image || page.featured_image}
                url={page.canonical_url || currentUrl}
            />

            {/* Hero Header */}
            <div className="relative bg-slate-900 pt-32 pb-32 lg:pb-40 overflow-hidden print:hidden">
                {page.featured_image && (
                    <div className="absolute inset-0 opacity-20">
                        <img src={page.featured_image} alt="" className="w-full h-full object-cover" />
                    </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/60 to-transparent"></div>

                <div className="container mx-auto px-4 relative z-10 max-w-7xl">
                    {/* Breadcrumbs */}
                    <nav className="flex items-center text-sm text-slate-400 mb-8 overflow-x-auto whitespace-nowrap pb-2">
                        <Link to="/" className="hover:text-white transition-colors flex items-center gap-1">
                            <Home className="w-3.5 h-3.5" /> Home
                        </Link>
                        <ChevronRight className="w-4 h-4 mx-2 shrink-0 opacity-50" />
                        <Link to="/pages" className="hover:text-white transition-colors">
                            Resources
                        </Link>
                        {page.categories && (
                            <>
                                <ChevronRight className="w-4 h-4 mx-2 shrink-0 opacity-50" />
                                <Link to={`/pages?category=${page.categories.id}`} className="hover:text-white transition-colors">
                                    {page.categories.name}
                                </Link>
                            </>
                        )}
                        <ChevronRight className="w-4 h-4 mx-2 shrink-0 opacity-50" />
                        <span className="text-white font-medium truncate max-w-[200px]">{page.title}</span>
                    </nav>

                    <div className="max-w-4xl">
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                        >
                            {page.categories && (
                                <Badge className="bg-blue-600 hover:bg-blue-700 text-white border-0 mb-6 px-3 py-1 text-sm font-medium rounded-full">
                                    {page.categories.name}
                                </Badge>
                            )}

                            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white mb-6 leading-tight tracking-tight">
                                {page.title}
                            </h1>

                            <div className="flex flex-wrap items-center gap-6 text-slate-300 text-sm md:text-base">
                                {page.users && (
                                    <div className="flex items-center gap-3">
                                        {page.users.avatar_url ? (
                                            <img src={page.users.avatar_url} alt={page.users.full_name} className="w-10 h-10 rounded-full border-2 border-slate-700" />
                                        ) : (
                                            <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center border-2 border-slate-700">
                                                <User className="w-5 h-5 text-slate-400" />
                                            </div>
                                        )}
                                        <span className="font-medium text-white">{page.users.full_name || 'Anonymous'}</span>
                                    </div>
                                )}

                                <div className="flex items-center gap-6 border-l border-slate-700 pl-6 ml-2">
                                    <span className="flex items-center gap-2" title="Published Date">
                                        <Calendar className="w-4 h-4 text-blue-400" />
                                        {new Date(page.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
                                    </span>

                                    {page.views !== undefined && (
                                        <span className="flex items-center gap-2" title="Total Views">
                                            <Eye className="w-4 h-4 text-emerald-400" />
                                            {page.views?.toLocaleString()} views
                                        </span>
                                    )}
                                </div>
                            </div>
                        </motion.div>
                    </div>
                </div>
            </div>

            <div className="container mx-auto px-4 -mt-20 relative z-20 max-w-7xl">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
                    {/* Main Content */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.1 }}
                        className="lg:col-span-8"
                    >
                        <div className="bg-white rounded-3xl shadow-xl border border-slate-100 overflow-hidden print:shadow-none print:border-none">
                            <div className="p-8 md:p-12">
                                {page.editor_type === 'visual' && page.content_published ? (
                                    <div className="puck-content">
                                        <Render config={puckConfig} data={page.content_published} />
                                    </div>
                                ) : (
                                    <div className="prose prose-slate prose-lg max-w-none prose-headings:font-bold prose-headings:text-slate-900 prose-headings:tracking-tight prose-a:text-blue-600 hover:prose-a:text-blue-700 prose-img:rounded-2xl prose-blockquote:border-l-4 prose-blockquote:border-blue-500 prose-blockquote:bg-slate-50 prose-blockquote:py-2 prose-blockquote:px-4 prose-blockquote:not-italic prose-blockquote:rounded-r-lg">
                                        <div dangerouslySetInnerHTML={sanitizeHTML(page.content)} />
                                    </div>
                                )}

                                {/* Post-Content Metadata */}
                                <div className="mt-12 pt-8 border-t border-slate-100 print:hidden">
                                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                                        {page.tags && page.tags.length > 0 && (
                                            <div className="flex flex-wrap gap-2">
                                                {page.tags.map((tag, i) => (
                                                    <span key={i} className="px-3 py-1.5 bg-slate-50 text-slate-600 rounded-lg text-sm font-medium border border-slate-200 hover:bg-slate-100 transition-colors cursor-default flex items-center gap-1.5">
                                                        <Tag className="w-3 h-3 text-slate-400" /> {tag}
                                                    </span>
                                                ))}
                                            </div>
                                        )}

                                        <div className="flex items-center gap-3">
                                            <Button variant="ghost" size="sm" onClick={handlePrint} className="text-slate-500 hover:text-slate-900">
                                                <Printer className="w-4 h-4 mr-2" /> Print
                                            </Button>
                                            <Button variant="ghost" size="sm" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="text-slate-500 hover:text-slate-900">
                                                Back to Top
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </motion.div>

                    {/* Sidebar */}
                    <div className="lg:col-span-4 space-y-8 print:hidden">

                        {/* Table of Contents */}
                        <div className="sticky top-24 space-y-8">
                            <TableOfContents content={page.content} />

                            {/* Widget Area: Default Sidebar */}
                            <WidgetAreaRenderer slug="default-sidebar" />

                            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                                <h4 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
                                    <Share2 className="w-4 h-4 text-blue-600" /> Share this page
                                </h4>
                                <ShareButtons
                                    url={currentUrl}
                                    title={page.title}
                                    description={page.excerpt}
                                />
                            </div>

                            {relatedPages.length > 0 && (
                                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                                    <h4 className="font-semibold text-slate-900 mb-6 pb-2 border-b border-slate-100">Related Pages</h4>
                                    <div className="space-y-6">
                                        {relatedPages.map(item => (
                                            <Link key={item.id} to={`/pages/${item.slug}`} className="group flex gap-4 items-start">
                                                <div className="w-16 h-16 rounded-lg bg-slate-100 overflow-hidden shrink-0">
                                                    {item.featured_image ? (
                                                        <img src={item.featured_image} alt="" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300" />
                                                    ) : (
                                                        <div className="w-full h-full flex items-center justify-center text-slate-300">
                                                            <FileText className="w-6 h-6" />
                                                        </div>
                                                    )}
                                                </div>
                                                <div>
                                                    <h5 className="text-sm font-semibold text-slate-900 group-hover:text-blue-600 transition-colors line-clamp-2 leading-snug mb-1">
                                                        {item.title}
                                                    </h5>
                                                    <span className="text-xs text-slate-400">
                                                        {new Date(item.created_at).toLocaleDateString()}
                                                    </span>
                                                </div>
                                            </Link>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default PublicPageDetail;
