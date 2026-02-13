import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/lib/customSupabaseClient';
import PublicPageDetail from '@/pages/public/PublicPageDetail';
import PublicBlogDetail from '@/pages/public/PublicBlogDetail';
import PublicProductDetail from '@/pages/public/PublicProductDetail';
import PublicPortfolioDetail from '@/pages/public/PublicPortfolioDetail';
import PublicPromotionDetail from '@/pages/public/PublicPromotionDetail';
import { FileQuestion, Loader2 } from 'lucide-react';
import SeoHelmet from '@/components/public/SeoHelmet';
import { Button } from '@/components/ui/button';
import { usePermissions } from '@/contexts/PermissionContext';

const PublicPageResolver = () => {
    const { slug } = useParams();
    const [contentType, setContentType] = useState(null);
    const [loading, setLoading] = useState(true);
    const { hasAnyPermission, isPlatformAdmin, isFullAccess } = usePermissions();

    // Check if user has permission to view drafts
    // We check a broad set of permissions to cover admins, editors, etc.
    const canViewDrafts = isPlatformAdmin || isFullAccess || hasAnyPermission([
        'edit_pages', 'edit_visual_pages', 'manage_pages',
        'edit_blogs', 'manage_blogs'
    ]);

    useEffect(() => {
        const resolveSlug = async () => {
            setLoading(true);
            try {
                const statusFilter = canViewDrafts ? ['published', 'draft'] : ['published'];

                // Priority 1: Pages (Most likely for root slugs)
                const { data: page } = await supabase
                    .from('pages')
                    .select('id, status')
                    .eq('slug', slug)
                    .in('status', statusFilter)
                    .maybeSingle();

                if (page) {
                    setContentType('page');
                    return;
                }

                // Priority 2: Blogs
                const { data: blog } = await supabase
                    .from('blogs')
                    .select('id, status')
                    .eq('slug', slug)
                    .in('status', statusFilter)
                    .maybeSingle();

                if (blog) {
                    setContentType('blog');
                    return;
                }

                // Priority 3: Products
                const { data: product } = await supabase
                    .from('products')
                    .select('id, status')
                    .eq('slug', slug)
                    .in('status', statusFilter)
                    .maybeSingle();

                if (product) {
                    setContentType('product');
                    return;
                }

                // Priority 4: Portfolio
                const { data: portfolio } = await supabase
                    .from('portfolio')
                    .select('id, status')
                    .eq('slug', slug)
                    .in('status', statusFilter)
                    .maybeSingle();

                if (portfolio) {
                    setContentType('portfolio');
                    return;
                }

                // Priority 5: Promotions
                // Promotions usually use 'active' vs 'inactive', but we'll check if they support 'draft' too
                // For now, assuming permissions allows seeing everything if needed, but keeping simple
                const promotionStatus = canViewDrafts ? ['active', 'draft', 'inactive'] : ['active'];
                const { data: promotion } = await supabase
                    .from('promotions')
                    .select('id, status')
                    .eq('slug', slug)
                    .in('status', promotionStatus)
                    .maybeSingle();

                if (promotion) {
                    setContentType('promotion');
                    return;
                }

                setContentType('not_found');

            } catch (error) {
                console.error('Error resolving slug:', error);
                setContentType('error');
            } finally {
                setLoading(false);
            }
        };

        if (slug) {
            resolveSlug();
        }
    }, [slug, canViewDrafts]);

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-white">
                <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
            </div>
        );
    }

    switch (contentType) {
        case 'page':
            return <PublicPageDetail />;
        case 'blog':
            return <PublicBlogDetail />;
        case 'product':
            return <PublicProductDetail />;
        case 'portfolio':
            return <PublicPortfolioDetail />;
        case 'promotion':
            return <PublicPromotionDetail />;
        case 'not_found':
        default:
            return (
                <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 px-4 text-center">
                    <SeoHelmet title="Page Not Found" />
                    <div className="bg-white p-12 rounded-3xl shadow-xl border border-slate-100 max-w-lg">
                        <div className="w-20 h-20 bg-amber-50 text-amber-500 rounded-full flex items-center justify-center mx-auto mb-6">
                            <FileQuestion className="w-10 h-10" />
                        </div>
                        <h2 className="text-3xl font-bold text-slate-900 mb-3">Page Not Found</h2>
                        <p className="text-slate-600 mb-8 text-lg">
                            We couldn&apos;t find any content matching this URL.<br />It might have been moved or doesn&apos;t exist.
                        </p>
                        <div className="flex justify-center">
                            <Button asChild className="bg-blue-600 hover:bg-blue-700">
                                <a href="/">Go Home</a>
                            </Button>
                        </div>
                    </div>
                </div>
            );
    }
};

export default PublicPageResolver;
