import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { Loader2, Calendar, ArrowRight, AlertCircle, Image as ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';
import { SelectField } from '../fields/SelectField';
import { ColorPickerField } from '../fields/ColorPickerField';

export const LatestArticlesBlock = ({
    count = 3,
    layout = 'grid',
    showImage = true,
    showDate = true,
    categoryFilter,
    titleColor,
    descriptionColor
}) => {
    const [articles, setArticles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchArticles = async () => {
            setLoading(true);
            try {
                let query = supabase
                    .from('articles')
                    // Foreign key is category_id. We fetch the related category data.
                    // We remove the explicit alias 'main_category' to avoid 'categories_1' auto-alias errors,
                    // or we check if 'main_category' is needed by the UI. 
                    // Looking at the block UI code (not shown but inferred), it likely needs 'main_category' or checks specific props.
                    // Let's try the standard relationship syntax without custom alias first to be safe, 
                    // OR adhere to exact Supabase syntax: select('*, categories!category_id(title, slug)')
                    .select('*, categories!category_id(title, slug)')
                    .eq('status', 'published')
                    .order('published_at', { ascending: false })
                    .limit(count);

                if (categoryFilter) {
                    query = query.eq('category_id', categoryFilter);
                }

                const { data, error } = await query;

                // Map data if necessary to match expected props (if UI expects main_category)
                const mappedData = data ? data.map(article => ({
                    ...article,
                    main_category: article.categories // Map default 'categories' response to 'main_category'
                })) : [];

                if (error) throw error;
                setArticles(mappedData || []);
            } catch (err) {
                console.error('Error fetching articles:', err);
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchArticles();
    }, [count, categoryFilter]);

    if (loading) {
        return (
            <div className="flex justify-center p-12 bg-slate-50 rounded-lg">
                <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center gap-2 p-4 text-red-600 bg-red-50 rounded-lg border border-red-200">
                <AlertCircle className="w-4 h-4" />
                <span>Error loading articles: {error}</span>
            </div>
        );
    }

    if (articles.length === 0) {
        return (
            <div className="text-center p-8 bg-slate-50 text-slate-500 rounded-lg border border-dashed border-slate-300">
                No articles found.
            </div>
        );
    }

    // Grid Layout
    if (layout === 'grid') {
        return (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {articles.map(article => (
                    <div key={article.id} className="group bg-white rounded-xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col h-full border border-slate-100">
                        {showImage && (
                            <div className="aspect-video w-full overflow-hidden bg-slate-100 relative">
                                {article.featured_image ? (
                                    <img
                                        src={article.featured_image}
                                        alt={article.title}
                                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                    />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-slate-300">
                                        <ImageIcon className="w-10 h-10" />
                                    </div>
                                )}
                                <div className="absolute top-4 left-4">
                                    <span className="bg-white/90 backdrop-blur px-3 py-1 text-xs font-bold uppercase tracking-wider rounded-full shadow-sm text-slate-800">
                                        {article.main_category?.title || 'News'}
                                    </span>
                                </div>
                            </div>
                        )}
                        <div className="p-6 flex flex-col flex-1">
                            {showDate && article.published_at && (
                                <div className="flex items-center gap-2 text-xs text-slate-500 mb-3">
                                    <Calendar className="w-3 h-3" />
                                    {format(new Date(article.published_at), 'MMMM dd, yyyy')}
                                </div>
                            )}
                            <h3 className="text-xl font-bold text-slate-900 mb-3 group-hover:text-blue-600 transition-colors line-clamp-2">
                                <Link to={`/news/${article.slug}`}>{article.title}</Link>
                            </h3>
                            <p className="text-slate-600 text-sm mb-6 line-clamp-3">
                                {article.summary || article.meta_description}
                            </p>
                            <div className="mt-auto">
                                <Button variant="link" className="p-0 h-auto font-semibold text-blue-600 hover:text-blue-700 hover:no-underline group/btn">
                                    Read More
                                    <ArrowRight className="w-4 h-4 ml-1 group-hover/btn:translate-x-1 transition-transform" />
                                </Button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    // List Layout
    return (
        <div className="space-y-6 max-w-4xl mx-auto">
            {articles.map(article => (
                <div key={article.id} className="group flex flex-col md:flex-row gap-6 bg-white p-4 rounded-xl shadow-sm hover:shadow-md transition-shadow border border-slate-100">
                    {showImage && (
                        <div className="w-full md:w-48 aspect-video md:aspect-square shrink-0 rounded-lg overflow-hidden bg-slate-100">
                            {article.featured_image ? (
                                <img
                                    src={article.featured_image}
                                    alt={article.title}
                                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-slate-300">
                                    <ImageIcon className="w-8 h-8" />
                                </div>
                            )}
                        </div>
                    )}
                    <div className="flex-1 py-1">
                        <div className="flex items-center gap-3 mb-2">
                            <span className="text-xs font-bold text-blue-600 uppercase tracking-wider">
                                {article.main_category?.title || 'News'}
                            </span>
                            {showDate && article.published_at && (
                                <>
                                    <span className="w-1 h-1 rounded-full bg-slate-300"></span>
                                    <span className="text-xs text-slate-500 flex items-center gap-1">
                                        <Calendar className="w-3 h-3" />
                                        {format(new Date(article.published_at), 'MMMM dd, yyyy')}
                                    </span>
                                </>
                            )}
                        </div>
                        <h3 className="text-xl font-bold text-slate-900 mb-2 group-hover:text-blue-600 transition-colors">
                            <Link to={`/news/${article.slug}`}>{article.title}</Link>
                        </h3>
                        <p className="text-slate-600 text-sm mb-4 line-clamp-2">
                            {article.summary || article.meta_description}
                        </p>
                        <Button variant="link" className="p-0 h-auto font-semibold text-blue-600 hover:text-blue-700 hover:no-underline flex items-center gap-1">
                            Read article <ArrowRight className="w-4 h-4" />
                        </Button>
                    </div>
                </div>
            ))}
        </div>
    );
};

export const LatestArticlesBlockFields = {
    count: {
        type: 'select',
        label: 'Number of Articles',
        options: [
            { label: '3', value: 3 },
            { label: '6', value: 6 },
            { label: '9', value: 9 },
            { label: '12', value: 12 }
        ]
    },
    layout: {
        type: 'radio',
        label: 'Layout',
        options: [
            { label: 'Grid', value: 'grid' },
            { label: 'List', value: 'list' }
        ]
    },
    showImage: {
        type: 'radio',
        label: 'Show Featured Image',
        options: [{ label: 'Yes', value: true }, { label: 'No', value: false }]
    },
    showDate: {
        type: 'radio',
        label: 'Show Date',
        options: [{ label: 'Yes', value: true }, { label: 'No', value: false }]
    },
    categoryFilter: {
        type: 'custom',
        label: 'Filter by Category',
        fetchConfig: {
            table: 'categories',
            labelField: 'title',
            valueField: 'id'
        },
        render: SelectField
    },
    titleColor: { type: 'custom', label: 'Title Color', render: ColorPickerField },
    descriptionColor: { type: 'custom', label: 'Description Color', render: ColorPickerField }
};
