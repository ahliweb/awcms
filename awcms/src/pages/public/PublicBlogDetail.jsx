
import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@/lib/customSupabaseClient';
import { motion } from 'framer-motion';
import { Calendar, User, ArrowLeft, Tag, Clock, Facebook, Twitter, Linkedin, FileText } from 'lucide-react';
import SeoHelmet from '@/components/public/SeoHelmet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { sanitizeHTML } from '@/utils/sanitize';
import { stripHtml } from '@/utils/textUtils';

function PublicBlogDetail() {
    const { slug } = useParams();
    const [blog, setBlog] = useState(null);
    const [loading, setLoading] = useState(true);
    const [relatedBlogs, setRelatedBlogs] = useState([]);

    const incrementViews = async (id) => {
        // Optimistic update without waiting
        await supabase.rpc('increment_blog_view', { blog_id: id }).catch(() => { });
        // Alternative simple update if RPC not exists: 
        // await supabase.from('blogs').update({ views: (blog.views || 0) + 1 }).eq('id', id);
    };

    const fetchRelated = async (categoryId, currentId) => {
        if (!categoryId) return;
        const { data } = await supabase
            .from('blogs')
            .select('id, title, slug, featured_image, published_at')
            .eq('category_id', categoryId)
            .eq('status', 'published')
            .neq('id', currentId)
            .limit(3);
        if (data) setRelatedBlogs(data);
    };

    useEffect(() => {
        const fetchDetail = async () => {
            setLoading(true);
            // Fetch blog details
            const { data, error } = await supabase
                .from('blogs')
                .select(`*, categories(name), author:users!blogs_author_id_fkey(full_name)`)
                .eq('slug', slug)
                .eq('status', 'published') // Strict check
                .maybeSingle();

            if (!error && data) {
                setBlog(data);
                incrementViews(data.id);
                fetchRelated(data.category_id, data.id);
            } else {
                // Fallback without author if FK issue
                if (error && error.code === 'PGRST201') {
                    const { data: fallbackData } = await supabase
                        .from('blogs')
                        .select(`*, categories(name)`)
                        .eq('slug', slug)
                        .eq('status', 'published')
                        .maybeSingle();
                    if (fallbackData) {
                        setBlog(fallbackData);
                        incrementViews(fallbackData.id);
                        fetchRelated(fallbackData.category_id, fallbackData.id);
                    }
                }
            }
            setLoading(false);
        };
        fetchDetail();
    }, [slug]);

    if (loading) {
        return (
            <div className="min-h-screen bg-white animate-pulse">
                <div className="h-96 bg-slate-200 w-full"></div>
                <div className="container mx-auto px-4 max-w-3xl -mt-20 relative z-10 bg-white p-12 rounded-2xl shadow-sm border border-slate-100">
                    <div className="h-10 bg-slate-200 rounded w-3/4 mb-6"></div>
                    <div className="h-4 bg-slate-200 rounded w-1/2 mb-12"></div>
                    <div className="space-y-4">
                        <div className="h-4 bg-slate-200 rounded w-full"></div>
                        <div className="h-4 bg-slate-200 rounded w-full"></div>
                        <div className="h-4 bg-slate-200 rounded w-5/6"></div>
                    </div>
                </div>
            </div>
        );
    }

    if (!blog) return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 px-4">
            <div className="text-center">
                <h2 className="text-3xl font-bold text-slate-800 mb-4">Blog Post Not Found</h2>
                <p className="text-slate-500 mb-8">The blog post you&apos;re looking for might have been removed or is temporarily unavailable.</p>
                <Link to="/blogs">
                    <Button className="bg-blue-600">Back to Blogs</Button>
                </Link>
            </div>
        </div>
    );

    const readingTime = Math.max(1, Math.ceil((blog.content?.length || 0) / 1000));
    const shareUrl = window.location.href;

    return (
        <article className="bg-slate-50 min-h-screen pb-20">
            <SeoHelmet
                type="blog_detail"
                id={blog.id}
                defaultTitle={`${blog.title} | Blog`}
                defaultDescription={blog.excerpt || stripHtml(blog.content).substring(0, 150)}
                defaultImage={blog.featured_image}
            />

            {/* Modern Hero Section */}
            <div className="relative h-[60vh] min-h-[500px] w-full bg-slate-900 overflow-hidden">
                {blog.featured_image && (
                    <div className="absolute inset-0">
                        <img src={blog.featured_image} alt="" className="w-full h-full object-cover opacity-60" />
                        <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/40 to-transparent"></div>
                    </div>
                )}

                <div className="absolute inset-0 flex flex-col justify-end pb-20 pt-32 container mx-auto px-4">
                    <Link to="/blogs" className="inline-flex items-center text-sm font-medium text-slate-300 hover:text-white mb-8 transition-colors bg-black/20 backdrop-blur-sm w-fit px-4 py-2 rounded-full border border-white/10 hover:bg-black/40">
                        <ArrowLeft className="w-4 h-4 mr-2" /> Back to Blogs
                    </Link>

                    <div className="max-w-4xl">
                        <div className="flex flex-wrap items-center gap-3 mb-6">
                            {blog.categories && (
                                <Badge className="bg-blue-600 hover:bg-blue-700 border-none text-white px-3 py-1 text-sm">
                                    {blog.categories.name}
                                </Badge>
                            )}
                            {blog.published_at && (
                                <span className="text-slate-300 text-sm bg-black/30 px-3 py-1 rounded-full backdrop-blur-sm border border-white/10 flex items-center gap-2">
                                    <Calendar className="w-3.5 h-3.5" />
                                    {new Date(blog.published_at).toLocaleDateString()}
                                </span>
                            )}
                        </div>

                        <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white mb-8 leading-tight drop-shadow-sm">
                            {blog.title}
                        </h1>

                        <div className="flex flex-wrap items-center gap-6 text-slate-300 text-sm font-medium">
                            {blog.author?.full_name && (
                                <span className="flex items-center gap-2">
                                    <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center border border-blue-400/30 text-blue-200">
                                        <User className="w-4 h-4" />
                                    </div>
                                    {blog.author.full_name}
                                </span>
                            )}
                            <span className="flex items-center gap-2">
                                <Clock className="w-4 h-4 text-slate-400" /> {readingTime} min read
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="container mx-auto px-4 grid grid-cols-1 lg:grid-cols-12 gap-12 -mt-10 relative z-20">
                {/* Main Content */}
                <div className="lg:col-span-8">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-white rounded-2xl shadow-xl border border-slate-100 p-8 md:p-12"
                    >
                        <div className="prose prose-slate prose-lg max-w-none leading-relaxed text-slate-700">
                            <div dangerouslySetInnerHTML={sanitizeHTML(blog.content)} />
                        </div>

                        {/* Footer of Content */}
                        <div className="mt-12 pt-8 border-t border-slate-100">
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                                {blog.tags && blog.tags.length > 0 && (
                                    <div className="flex flex-wrap gap-2">
                                        {blog.tags.map((tag, i) => (
                                            <span key={i} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-50 text-slate-600 text-sm hover:bg-slate-100 transition-colors border border-slate-200 cursor-default">
                                                <Tag className="w-3 h-3 text-slate-400" /> {tag}
                                            </span>
                                        ))}
                                    </div>
                                )}

                                <div className="flex items-center gap-2">
                                    <Button variant="outline" size="icon" className="rounded-full text-slate-500 hover:text-blue-600 hover:border-blue-200" onClick={() => window.open(`https://www.facebook.com/sharer/sharer.php?u=${shareUrl}`, '_blank')}>
                                        <Facebook className="w-4 h-4" />
                                    </Button>
                                    <Button variant="outline" size="icon" className="rounded-full text-slate-500 hover:text-sky-500 hover:border-sky-200" onClick={() => window.open(`https://twitter.com/intent/tweet?url=${shareUrl}&text=${blog.title}`, '_blank')}>
                                        <Twitter className="w-4 h-4" />
                                    </Button>
                                    <Button variant="outline" size="icon" className="rounded-full text-slate-500 hover:text-blue-800 hover:border-blue-300" onClick={() => window.open(`https://www.linkedin.com/shareArticle?mini=true&url=${shareUrl}`, '_blank')}>
                                        <Linkedin className="w-4 h-4" />
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                </div>

                {/* Sidebar */}
                <div className="lg:col-span-4 space-y-8 mt-10 lg:mt-0">
                    {/* Author Box */}
                    <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
                        <h3 className="font-bold text-slate-900 mb-4 text-sm uppercase tracking-wider">About Author</h3>
                        <div className="flex items-center gap-4 mb-4">
                            <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                                <User className="w-8 h-8" />
                            </div>
                            <div>
                                <h4 className="font-bold text-slate-900 text-lg">{blog.author?.full_name || 'AhliWeb Team'}</h4>
                                <p className="text-slate-500 text-sm">Content Creator</p>
                            </div>
                        </div>
                        <p className="text-slate-600 text-sm leading-relaxed">
                            Passionate about technology and digital innovation. Sharing insights to help businesses grow in the digital age.
                        </p>
                    </div>

                    {/* Related Blogs */}
                    {relatedBlogs.length > 0 && (
                        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
                            <h3 className="font-bold text-slate-900 mb-6 text-sm uppercase tracking-wider">Related Blogs</h3>
                            <div className="space-y-6">
                                {relatedBlogs.map(rel => (
                                    <Link key={rel.id} to={`/blogs/${rel.slug}`} className="flex gap-4 group">
                                        <div className="w-20 h-20 rounded-lg bg-slate-100 overflow-hidden flex-shrink-0">
                                            {rel.featured_image ? (
                                                <img src={rel.featured_image} alt="" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-slate-300"><FileText className="w-6 h-6" /></div>
                                            )}
                                        </div>
                                        <div>
                                            <h5 className="font-semibold text-slate-900 text-sm leading-snug mb-2 group-hover:text-blue-600 transition-colors line-clamp-2">
                                                {rel.title}
                                            </h5>
                                            <span className="text-xs text-slate-500">
                                                {new Date(rel.published_at || new Date()).toLocaleDateString()}
                                            </span>
                                        </div>
                                    </Link>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </article>
    );
}

export default PublicBlogDetail;
