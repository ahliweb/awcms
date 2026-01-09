
import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/customSupabaseClient';
import { motion } from 'framer-motion';
import { FileText, Calendar, ArrowRight, Search, Eye, X, Info, Loader2 } from 'lucide-react';
import SeoHelmet from '@/components/public/SeoHelmet';
import CategoryFilter from '@/components/public/CategoryFilter';
import { Pagination } from '@/components/ui/pagination';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useSearch } from '@/hooks/useSearch';
import { stripHtml } from '@/utils/textUtils';

function PublicArticles() {
    const [articles, setArticles] = useState([]);
    const [categories, setCategories] = useState([]);
    const [activeCategory, setActiveCategory] = useState(null);

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

    const [totalItems, setTotalItems] = useState(0);
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 9;

    useEffect(() => {
        const fetchCategories = async () => {
            const { data } = await supabase
                .from('categories')
                .select('*')
                .eq('type', 'articles')
                .is('deleted_at', null)
                .order('name');
            if (data) setCategories(data);
        };
        fetchCategories();
    }, []);

    const fetchArticles = useCallback(async () => {
        setSearchLoading(true);
        const from = (currentPage - 1) * itemsPerPage;
        const to = from + itemsPerPage - 1;

        try {
            let queryBuilder = supabase
                .from('articles')
                .select(`
            *, 
            categories(name), 
            author:users!articles_author_id_fkey(full_name)
        `, { count: 'exact' })
                .eq('status', 'published')
                .is('deleted_at', null)
                .order('published_at', { ascending: false });

            if (activeCategory) {
                queryBuilder = queryBuilder.eq('category_id', activeCategory);
            }

            // Only apply search if we have a valid debounced query
            if (debouncedQuery) {
                queryBuilder = queryBuilder.ilike('title', `%${debouncedQuery}%`);
            }

            const { data, count, error } = await queryBuilder.range(from, to);

            if (error) throw error;

            setArticles(data || []);
            setTotalItems(count || 0);
        } catch (err) {
            console.error("Fetch Error:", err);
        } finally {
            setSearchLoading(false);
        }
    }, [currentPage, itemsPerPage, activeCategory, debouncedQuery, setSearchLoading]);

    useEffect(() => {
        fetchArticles();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, [fetchArticles]);


    const totalPages = Math.ceil(totalItems / itemsPerPage);

    return (
        <div className="bg-slate-50 min-h-screen pb-20">
            <SeoHelmet type="articles" defaultTitle="Articles & Blog | AhliWeb" defaultDescription="Read our latest news, insights and updates." />

            <div className="bg-white border-b border-slate-200 pt-16 pb-12">
                <div className="container mx-auto px-4 text-center max-w-2xl">
                    <h1 className="text-4xl font-bold text-slate-900 mb-4 tracking-tight">Our Latest Insights</h1>
                    <p className="text-lg text-slate-600">Discover articles, tutorials, and news curated by our team of experts.</p>
                </div>
            </div>

            <div className="container mx-auto px-4 -mt-6">
                <div className="bg-white rounded-xl shadow-lg border border-slate-100 p-4 mb-10 flex flex-col md:flex-row items-start md:items-center gap-4 max-w-5xl mx-auto">
                    <div className="relative w-full md:w-80">
                        <div className="relative">
                            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                            <Input
                                placeholder={`Search articles (${minLength}+ chars)...`}
                                value={query}
                                onChange={(e) => { setQuery(e.target.value); setCurrentPage(1); }}
                                className={`pl-9 pr-16 bg-slate-50 border-slate-200 transition-colors ${!isValid ? 'border-amber-300 focus:ring-amber-200' : ''}`}
                            />
                            <div className="absolute right-3 top-2.5 flex items-center gap-2">
                                {query && (
                                    <button onClick={clearSearch} className="hover:bg-slate-200 rounded-full p-0.5">
                                        <X className="h-3.5 w-3.5 text-slate-400 hover:text-slate-600" />
                                    </button>
                                )}
                                <span className={`text-[10px] font-mono ${!isValid && query.length > 0 ? 'text-amber-600 font-bold' : 'text-slate-400'}`}>
                                    {query.length}/{minLength}
                                </span>
                            </div>
                        </div>
                        {!isValid && query.length > 0 && (
                            <div className="absolute top-full left-0 mt-1 flex items-center gap-1.5 text-xs text-amber-600 font-medium animate-in slide-in-from-top-1 px-1">
                                <Info className="w-3 h-3" />
                                {message}
                            </div>
                        )}
                    </div>

                    <div className="w-px h-8 bg-slate-200 hidden md:block"></div>

                    <div className="flex-1 overflow-x-auto w-full pb-2 md:pb-0 hide-scrollbar">
                        <CategoryFilter categories={categories} activeCategory={activeCategory} onSelect={(id) => { setActiveCategory(id); setCurrentPage(1); }} />
                    </div>
                </div>

                {searchLoading ? (
                    <div className="flex flex-col items-center justify-center py-20">
                        <Loader2 className="w-10 h-10 text-blue-600 animate-spin mb-4" />
                        <p className="text-slate-500">Searching content...</p>
                    </div>
                ) : (
                    <>
                        {articles.length > 0 ? (
                            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 mb-12">
                                {articles.map((item, i) => (
                                    <motion.div
                                        key={item.id}
                                        initial={{ opacity: 0, y: 20 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: i * 0.05 }}
                                        className="bg-white rounded-2xl overflow-hidden shadow-sm border border-slate-200 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group flex flex-col h-full"
                                    >
                                        <Link to={`/articles/${item.slug}`} className="block relative overflow-hidden h-52 bg-slate-100">
                                            {item.featured_image ? (
                                                <img src={item.featured_image} alt={item.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-slate-300 bg-slate-50">
                                                    <FileText className="w-12 h-12 opacity-50" />
                                                </div>
                                            )}
                                            {item.categories && (
                                                <div className="absolute top-4 left-4">
                                                    <Badge className="bg-white/95 text-slate-800 hover:bg-white border-0 shadow-sm backdrop-blur-sm px-3 py-1 text-xs">
                                                        {item.categories.name}
                                                    </Badge>
                                                </div>
                                            )}
                                        </Link>

                                        <div className="p-6 flex-1 flex flex-col">
                                            <div className="flex items-center gap-4 text-xs text-slate-500 mb-4 font-medium">
                                                <span className="flex items-center gap-1.5 bg-slate-50 px-2 py-1 rounded-md border border-slate-100">
                                                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                                                    {new Date(item.published_at || item.created_at).toLocaleDateString()}
                                                </span>
                                            </div>
                                            <h3 className="font-bold text-xl text-slate-900 mb-3 line-clamp-2 leading-tight group-hover:text-blue-600 transition-colors">
                                                <Link to={`/articles/${item.slug}`}>{item.title}</Link>
                                            </h3>
                                            <p className="text-slate-600 text-sm line-clamp-3 mb-6 flex-1 leading-relaxed">
                                                {item.excerpt || stripHtml(item.content).substring(0, 150) + '...'}
                                            </p>
                                            <div className="pt-4 border-t border-slate-100 flex justify-between items-center mt-auto">
                                                <Link to={`/articles/${item.slug}`} className="inline-flex items-center text-sm font-semibold text-blue-600 hover:text-blue-700">
                                                    Read Article <ArrowRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
                                                </Link>
                                                {item.views > 0 && (
                                                    <span className="text-xs text-slate-400 flex items-center gap-1">
                                                        <Eye className="w-3 h-3" /> {item.views}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </motion.div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-slate-200">
                                <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                                    <Search className="w-8 h-8 text-slate-300" />
                                </div>
                                <h3 className="text-lg font-medium text-slate-900">No articles found</h3>
                                <p className="text-slate-500 max-w-sm mx-auto mt-2">
                                    {debouncedQuery
                                        ? `No results found for "${debouncedQuery}". Try different keywords.`
                                        : "We couldn't find any articles matching your filters."}
                                </p>
                                <button onClick={() => { clearSearch(); setActiveCategory(null); }} className="mt-6 text-blue-600 hover:underline text-sm font-medium">
                                    Clear all filters
                                </button>
                            </div>
                        )}
                        {articles.length > 0 && (
                            <div className="flex justify-center mt-8">
                                <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

export default PublicArticles;
