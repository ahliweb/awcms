
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { motion } from 'framer-motion';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Calendar, User, ArrowRight, Search, X, Info, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSearch } from '@/hooks/useSearch';

function PublicPortfolio() {
    const { t } = useTranslation();
    const [items, setItems] = useState([]);

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

    useEffect(() => {
        const fetchPortfolio = async () => {
            setSearchLoading(true);
            let queryBuilder = supabase
                .from('portfolio')
                .select('*, categories(name)')
                .eq('status', 'published')
                .order('project_date', { ascending: false });

            if (debouncedQuery) {
                queryBuilder = queryBuilder.ilike('title', `%${debouncedQuery}%`);
            }

            const { data } = await queryBuilder;
            setItems(data || []);
            setSearchLoading(false);
        };
        fetchPortfolio();
    }, [debouncedQuery, setSearchLoading]);


    return (
        <div className="min-h-screen bg-background py-16">
            <Helmet><title>{t('portfolio.title', 'Our Portfolio')} - AWCMS</title></Helmet>

            <div className="container mx-auto px-4">
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-12">
                    <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-4">{t('portfolio.title', 'Our Portfolio')}</h1>
                    <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8">
                        {t('portfolio.subtitle', 'Explore our latest projects and success stories.')}
                    </p>

                    <div className="max-w-md mx-auto relative">
                        <div className="relative">
                            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                            <Input
                                placeholder={`Search projects (${minLength}+ chars)...`}
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                className={`pl-9 pr-14 ${!isValid ? 'border-amber-300 ring-amber-100' : ''}`}
                            />
                            <div className="absolute right-3 top-2.5 flex items-center gap-2">
                                {query && <button onClick={clearSearch}><X className="h-4 w-4 text-slate-400" /></button>}
                                <span className={`text-[10px] ${!isValid && query.length > 0 ? 'text-amber-500 font-bold' : 'text-slate-400'}`}>
                                    {query.length}/{minLength}
                                </span>
                            </div>
                        </div>
                        {!isValid && query.length > 0 && (
                            <div className="text-xs text-amber-600 font-medium mt-1 flex justify-center items-center gap-1">
                                <Info className="w-3 h-3" /> {message}
                            </div>
                        )}
                    </div>
                </motion.div>

                {searchLoading ? (
                    <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-slate-300" /></div>
                ) : (
                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
                        {items.length > 0 ? items.map((item, i) => (
                            <motion.div
                                key={item.id}
                                initial={{ opacity: 0, y: 20 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true }}
                                transition={{ delay: i * 0.1 }}
                                className="group bg-card rounded-2xl border border-border overflow-hidden hover:shadow-lg transition-all"
                            >
                                <div className="aspect-video bg-muted relative overflow-hidden">
                                    {item.images?.[0] ? (
                                        <img
                                            src={item.images[0].url}
                                            alt={item.title}
                                            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                                        />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-muted-foreground">No Image</div>
                                    )}
                                    <div className="absolute top-4 left-4">
                                        <Badge variant="secondary" className="bg-background/90 backdrop-blur-sm border-border text-foreground">
                                            {item.categories?.name || 'Project'}
                                        </Badge>
                                    </div>
                                </div>
                                <div className="p-6">
                                    <h3 className="text-xl font-bold text-foreground mb-2 line-clamp-1">{item.title}</h3>
                                    <p className="text-muted-foreground line-clamp-2 text-sm mb-4">{item.description || 'No description available.'}</p>
                                    <div className="flex items-center gap-4 text-xs text-muted-foreground mb-6">
                                        {item.client && <div className="flex items-center gap-1.5"><User className="w-3.5 h-3.5" /><span>{item.client}</span></div>}
                                        {item.project_date && <div className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /><span>{new Date(item.project_date).getFullYear()}</span></div>}
                                    </div>
                                    <Link to={`/portfolio/${item.slug}`}>
                                        <Button className="w-full gap-2 group-hover:translate-x-1 transition-transform">View Project <ArrowRight className="w-4 h-4" /></Button>
                                    </Link>
                                </div>
                            </motion.div>
                        )) : (
                            <div className="col-span-full text-center py-12 text-slate-400">
                                <p>No projects found matching your search.</p>
                                <Button variant="link" onClick={clearSearch}>Clear Search</Button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

export default PublicPortfolio;
