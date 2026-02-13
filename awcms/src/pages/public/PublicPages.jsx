
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/customSupabaseClient';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import SeoHelmet from '@/components/public/SeoHelmet';
import { ArrowRight, FileText, Calendar, Search, ArrowUpDown, X, Info, Loader2 } from 'lucide-react';
import CategoryFilter from '@/components/public/CategoryFilter';
import { Pagination } from '@/components/ui/pagination';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useSearch } from '@/hooks/useSearch';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function PublicPages() {
    const { t } = useTranslation();
    const [pages, setPages] = useState([]);
    const [categories, setCategories] = useState([]);
    const [activeCategory, setActiveCategory] = useState(null);
    const [sortBy, setSortBy] = useState('newest');

    const {
        query,
        setQuery,
        debouncedQuery,
        isValid,
        message,
        minLength,
        clearSearch,
        loading: searchLoading,
        setLoading: setSearchLoading
    } = useSearch({ minLength: 5 });

    const [currentPage, setCurrentPage] = useState(1);
    const [totalItems, setTotalItems] = useState(0);
    const itemsPerPage = 9;

    useEffect(() => {
        const fetchCategories = async () => {
            const { data } = await supabase.from('categories').select('*').eq('type', 'pages').is('deleted_at', null);
            if (data) setCategories(data);
        };
        fetchCategories();
    }, []);

    useEffect(() => {
        const fetchPages = async () => {
            setSearchLoading(true);
            try {
                const from = (currentPage - 1) * itemsPerPage;
                const to = from + itemsPerPage - 1;

                let queryBuilder = supabase
                    .from('pages')
                    .select('id, title, slug, excerpt, created_at, featured_image, categories!pages_category_id_fkey(name)', { count: 'exact' })
                    .eq('status', 'published')
                    .eq('is_public', true)
                    .is('deleted_at', null);

                if (activeCategory) queryBuilder = queryBuilder.eq('category_id', activeCategory);
                if (debouncedQuery) queryBuilder = queryBuilder.ilike('title', `%${debouncedQuery}%`);

                switch (sortBy) {
                    case 'newest': queryBuilder = queryBuilder.order('created_at', { ascending: false }); break;
                    case 'oldest': queryBuilder = queryBuilder.order('created_at', { ascending: true }); break;
                    case 'az': queryBuilder = queryBuilder.order('title', { ascending: true }); break;
                    case 'za': queryBuilder = queryBuilder.order('title', { ascending: false }); break;
                    default: queryBuilder = queryBuilder.order('created_at', { ascending: false });
                }

                const { data, count, error } = await queryBuilder.range(from, to);
                if (error) throw error;

                setPages(data || []);
                setTotalItems(count || 0);
            } catch (err) {
                console.error("Fetch Pages Error:", err);
            } finally {
                setSearchLoading(false);
            }
        };
        fetchPages();
    }, [currentPage, activeCategory, debouncedQuery, sortBy, setSearchLoading]);

    const totalPages = Math.ceil(totalItems / itemsPerPage);

    return (
        <div className="min-h-screen bg-slate-50/50">
            <SeoHelmet type="pages" defaultTitle="Pages & Resources" defaultDescription="Browse our collection of pages, guides, and resources." />

            <div className="bg-white border-b border-slate-200 py-16 lg:py-24">
                <div className="container mx-auto px-4 text-center max-w-2xl">
                    <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-4xl md:text-5xl font-extrabold text-slate-900 mb-6 tracking-tight">
                        {t('Resources & Pages')}
                    </motion.h1>
                    <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="text-lg text-slate-600 leading-relaxed">
                        {t('Explore our comprehensive documentation, company updates, and informative guides designed to help you succeed.')}
                    </motion.p>
                </div>
            </div>

            <div className="container mx-auto px-4 py-12">
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-10 flex flex-col lg:flex-row items-center gap-6 justify-between sticky top-24 z-30">
                    <div className="w-full lg:w-auto overflow-x-auto pb-2 lg:pb-0">
                        <CategoryFilter categories={categories} activeCategory={activeCategory} onSelect={(id) => { setActiveCategory(id); setCurrentPage(1); }} />
                    </div>

                    <div className="flex w-full lg:w-auto items-center gap-3">
                        <div className="relative w-full md:w-64">
                            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                            <Input
                                placeholder={t('Search... (5+ chars)')}
                                value={query}
                                onChange={(e) => { setQuery(e.target.value); setCurrentPage(1); }}
                                className={`pl-9 pr-14 bg-slate-50 border-slate-200 ${!isValid ? 'border-amber-300 ring-amber-200' : ''}`}
                            />
                            <div className="absolute right-3 top-2.5 flex items-center gap-2">
                                {query && (
                                    <button onClick={clearSearch}><X className="h-3.5 w-3.5 text-slate-400" /></button>
                                )}
                                <span className={`text-[10px] ${!isValid && query.length > 0 ? 'text-amber-500 font-bold' : 'text-slate-400'}`}>
                                    {query.length}/{minLength}
                                </span>
                            </div>
                            {!isValid && query.length > 0 && (
                                <div className="absolute top-full right-0 mt-1 flex items-center gap-1 text-[10px] text-amber-600 font-medium bg-amber-50 px-2 py-1 rounded border border-amber-100 shadow-sm z-50">
                                    <Info className="w-3 h-3" /> {message}
                                </div>
                            )}
                        </div>

                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" className="gap-2 shrink-0">
                                    <ArrowUpDown className="w-4 h-4" />
                                    <span className="hidden sm:inline">Sort</span>
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => setSortBy('newest')}>Newest First</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setSortBy('oldest')}>Oldest First</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setSortBy('az')}>Title (A-Z)</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setSortBy('za')}>Title (Z-A)</DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>

                {searchLoading ? (
                    <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-slate-400" /></div>
                ) : (
                    <>
                        {pages.length > 0 ? (
                            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
                                {pages.map((page, i) => (
                                    <motion.div
                                        key={page.id}
                                        initial={{ opacity: 0, y: 20 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: i * 0.05 }}
                                        className="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 flex flex-col overflow-hidden group h-full"
                                    >
                                        <Link to={`/pages/${page.slug}`} className="block h-52 overflow-hidden relative">
                                            {page.featured_image ? (
                                                <img src={page.featured_image} alt={page.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                                            ) : (
                                                <div className="w-full h-full bg-slate-50 flex items-center justify-center border-b border-slate-100">
                                                    <FileText className="w-12 h-12 text-slate-300" />
                                                </div>
                                            )}
                                            {page.categories && (
                                                <div className="absolute top-4 left-4">
                                                    <span className="text-xs font-bold tracking-wide text-blue-700 bg-white/90 backdrop-blur-sm px-3 py-1 rounded-full shadow-sm border border-blue-100">
                                                        {page.categories.name}
                                                    </span>
                                                </div>
                                            )}
                                        </Link>

                                        <div className="p-6 flex-1 flex flex-col">
                                            <div className="flex items-center gap-2 mb-3 text-xs text-slate-400">
                                                <Calendar className="w-3.5 h-3.5" />
                                                {new Date(page.created_at).toLocaleDateString()}
                                            </div>
                                            <h2 className="text-xl font-bold text-slate-900 mb-3 group-hover:text-blue-600 transition-colors line-clamp-2">
                                                <Link to={`/pages/${page.slug}`}>{page.title}</Link>
                                            </h2>
                                            <p className="text-slate-600 mb-6 line-clamp-3 text-sm leading-relaxed flex-1">
                                                {page.excerpt || t("Click to read full content...")}
                                            </p>
                                            <div className="mt-auto pt-5 border-t border-slate-50 flex items-center justify-between">
                                                <Link to={`/pages/${page.slug}`} className="inline-flex items-center text-blue-600 font-semibold hover:text-blue-700 text-sm group-hover:translate-x-1 transition-transform">
                                                    {t('Read More')} <ArrowRight className="w-4 h-4 ml-1" />
                                                </Link>
                                            </div>
                                        </div>
                                    </motion.div>
                                ))}
                            </div>
                        ) : (
                            <div className="col-span-full py-32 text-center bg-white rounded-3xl border border-slate-200 border-dashed">
                                <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-6 border border-slate-100">
                                    <Search className="w-10 h-10 text-slate-300" />
                                </div>
                                <h3 className="text-xl font-bold text-slate-900 mb-2">{t('No pages found')}</h3>
                                <p className="text-slate-500 max-w-md mx-auto">{t('We couldn\'t find any pages matching your current filters.')}</p>
                                <Button variant="outline" className="mt-6" onClick={() => { clearSearch(); setActiveCategory(null); }}>
                                    {t('Clear Filters')}
                                </Button>
                            </div>
                        )}
                    </>
                )}

                {pages.length > 0 && (
                    <div className="flex justify-center mt-16">
                        <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
                    </div>
                )}
            </div>
        </div>
    );
}

export default PublicPages;
