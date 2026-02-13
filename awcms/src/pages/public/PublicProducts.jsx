
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/customSupabaseClient';
import { motion } from 'framer-motion';
import { ShoppingBag, Search, Filter, X, Info, Loader2 } from 'lucide-react';
import SeoHelmet from '@/components/public/SeoHelmet';
import CategoryFilter from '@/components/public/CategoryFilter';
import { Pagination } from '@/components/ui/pagination';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useSearch } from '@/hooks/useSearch';

function PublicProducts() {
    const [products, setProducts] = useState([]);
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

    const [currentPage, setCurrentPage] = useState(1);
    const [totalItems, setTotalItems] = useState(0);
    const itemsPerPage = 9;

    useEffect(() => {
        const fetchCategories = async () => {
            const { data } = await supabase.from('categories').select('*').eq('type', 'products').is('deleted_at', null);
            if (data) setCategories(data);
        };
        fetchCategories();
    }, []);

    useEffect(() => {
        const fetchProducts = async () => {
            setSearchLoading(true);
            const from = (currentPage - 1) * itemsPerPage;
            const to = from + itemsPerPage - 1;

            let queryBuilder = supabase
                .from('products')
                .select(`*, categories (name), product_types (name)`, { count: 'exact' })
                .eq('status', 'active')
                .is('deleted_at', null)
                .order('created_at', { ascending: false });

            if (activeCategory) queryBuilder = queryBuilder.eq('category_id', activeCategory);
            if (debouncedQuery) queryBuilder = queryBuilder.ilike('name', `%${debouncedQuery}%`);

            const { data, count, error } = await queryBuilder.range(from, to);
            if (!error) {
                setProducts(data || []);
                setTotalItems(count || 0);
            }
            setSearchLoading(false);
        };
        fetchProducts();
    }, [currentPage, activeCategory, debouncedQuery, setSearchLoading]);


    const totalPages = Math.ceil(totalItems / itemsPerPage);
    const formatPrice = (price) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(price);

    return (
        <div className="container mx-auto px-4 py-12">
            <SeoHelmet type="products" defaultTitle="Our Products | AhliWeb" defaultDescription="Browse our catalog of high-quality products." />

            <div className="flex flex-col md:flex-row justify-between items-end gap-6 mb-12 border-b border-slate-100 pb-8">
                <div className="max-w-2xl">
                    <h1 className="text-4xl font-bold text-slate-900 mb-4">Product Catalog</h1>
                    <p className="text-slate-600 text-lg">Discover solutions designed to help your business grow.</p>
                </div>
                <div className="relative w-full md:w-80">
                    <div className="relative">
                        <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                        <Input
                            placeholder={`Search products (${minLength}+ chars)...`}
                            value={query}
                            onChange={(e) => { setQuery(e.target.value); setCurrentPage(1); }}
                            className={`pl-9 pr-14 h-11 transition-all ${!isValid ? 'border-amber-300 ring-2 ring-amber-100' : ''}`}
                        />
                        <div className="absolute right-3 top-3 flex items-center gap-2">
                            {query && <button onClick={clearSearch}><X className="h-4 w-4 text-slate-400" /></button>}
                            <span className={`text-xs ${!isValid && query.length > 0 ? 'text-amber-500 font-bold' : 'text-slate-400'}`}>
                                {query.length}/{minLength}
                            </span>
                        </div>
                    </div>
                    {!isValid && query.length > 0 && (
                        <div className="absolute right-0 top-full mt-1 text-xs text-amber-600 font-medium flex items-center gap-1">
                            <Info className="w-3 h-3" /> {message}
                        </div>
                    )}
                </div>
            </div>

            <div className="flex flex-col lg:flex-row gap-8 items-start">
                <div className="w-full lg:w-64 flex-shrink-0 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm sticky top-24">
                    <div className="flex items-center gap-2 font-bold text-slate-900 mb-4">
                        <Filter className="w-4 h-4" /> Categories
                    </div>
                    <CategoryFilter categories={categories} activeCategory={activeCategory} onSelect={(id) => { setActiveCategory(id); setCurrentPage(1); }} vertical={true} />
                </div>

                <div className="flex-1 w-full">
                    {searchLoading ? (
                        <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-slate-300" /></div>
                    ) : (
                        <>
                            {products.length > 0 ? (
                                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
                                    {products.map((item, i) => (
                                        <motion.div
                                            key={item.id}
                                            initial={{ opacity: 0, scale: 0.95 }}
                                            animate={{ opacity: 1, scale: 1 }}
                                            transition={{ delay: i * 0.05 }}
                                            className="bg-white rounded-2xl overflow-hidden shadow-sm border border-slate-200 hover:shadow-xl transition-all group flex flex-col h-full"
                                        >
                                            <Link to={`/products/${item.slug}`} className="block relative aspect-square bg-slate-50 overflow-hidden p-8 flex items-center justify-center">
                                                {item.images && item.images.length > 0 ? (
                                                    <img
                                                        src={typeof item.images[0] === 'string' ? item.images[0] : item.images[0].url}
                                                        alt={item.name}
                                                        className="w-full h-full object-contain mix-blend-multiply group-hover:scale-110 transition-transform duration-500"
                                                    />
                                                ) : (
                                                    <ShoppingBag className="w-16 h-16 text-slate-200" />
                                                )}
                                                {item.discount_price && <div className="absolute top-4 left-4 bg-red-500 text-white text-xs font-bold px-2 py-1 rounded">SALE</div>}
                                            </Link>
                                            <div className="p-5 flex-1 flex flex-col">
                                                <div className="text-xs text-slate-500 mb-2 flex items-center gap-1">
                                                    {item.categories?.name}
                                                    {item.product_types && <>• {item.product_types.name}</>}
                                                </div>
                                                <h3 className="font-bold text-lg text-slate-900 mb-2 leading-tight group-hover:text-blue-600 transition-colors">
                                                    <Link to={`/products/${item.slug}`}>{item.name}</Link>
                                                </h3>
                                                <div className="mt-auto pt-4 flex items-center justify-between">
                                                    <div>
                                                        {item.discount_price ? (
                                                            <div className="flex flex-col">
                                                                <span className="text-slate-400 text-xs line-through">{formatPrice(item.price)}</span>
                                                                <span className="text-lg font-bold text-red-600">{formatPrice(item.discount_price)}</span>
                                                            </div>
                                                        ) : (
                                                            <span className="text-lg font-bold text-slate-900">{formatPrice(item.price)}</span>
                                                        )}
                                                    </div>
                                                    <Button size="sm" variant="outline" className="rounded-full hover:bg-blue-50 hover:text-blue-600 border-slate-200">View Details</Button>
                                                </div>
                                            </div>
                                        </motion.div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-20 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                                    <ShoppingBag className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                                    <h3 className="text-lg font-medium text-slate-900">No products found</h3>
                                    <Button variant="outline" className="mt-4" onClick={() => { clearSearch(); setActiveCategory(null); }}>Clear Filters</Button>
                                </div>
                            )}
                            {products.length > 0 && (
                                <div className="flex justify-center mt-8">
                                    <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

export default PublicProducts;
