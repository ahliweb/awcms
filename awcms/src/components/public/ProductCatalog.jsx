/**
 * Product Catalog - Public product listing with cart functionality
 */
import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ShoppingCart, Plus, Filter, Grid, List, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { useCart } from '@/contexts/CartContext';
import { useTenant } from '@/contexts/TenantContext';
import { getCategoryTypesForModule } from '@/lib/taxonomy';

function ProductCatalog() {
    const { toast } = useToast();
    const { addItem, itemCount } = useCart();
    const { currentTenant } = useTenant();

    const [products, setProducts] = useState([]);
    const [categories, setCategories] = useState([]);
    const [loading, setLoading] = useState(true);
    const [viewMode, setViewMode] = useState('grid');

    // Filters
    const [search, setSearch] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('all');
    const [sortBy, setSortBy] = useState('newest');
    const [priceRange] = useState({ min: '', max: '' });

    const fetchProducts = React.useCallback(async () => {
        if (!currentTenant?.id) return;

        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('products')
                .select(`
          *,
          category:categories(id, name),
          product_type:product_types(id, name)
        `)
                .eq('tenant_id', currentTenant.id)
                .eq('status', 'active')
                .eq('is_available', true)
                .is('deleted_at', null)
                .order('created_at', { ascending: false });

            if (error) throw error;
            setProducts(data || []);
        } catch (error) {
            console.error('Error fetching products:', error);
        } finally {
            setLoading(false);
        }
    }, [currentTenant?.id]);

    const fetchCategories = React.useCallback(async () => {
        if (!currentTenant?.id) return;

        try {
            const { data } = await supabase
                .from('categories')
                .select('id, name')
                .eq('tenant_id', currentTenant.id)
                .in('type', getCategoryTypesForModule('products'))
                .is('deleted_at', null)
                .order('name');

            setCategories(data || []);
        } catch (error) {
            console.error('Error fetching categories:', error);
        }
    }, [currentTenant?.id]);

    useEffect(() => {
        fetchProducts();
        fetchCategories();
    }, [fetchProducts, fetchCategories]);

    const handleAddToCart = async (product) => {
        if (product.stock <= 0) {
            toast({
                variant: 'destructive',
                title: 'Out of Stock',
                description: 'This product is currently out of stock.'
            });
            return;
        }

        const success = await addItem(product, 1);
        if (success) {
            toast({
                title: 'Added to Cart',
                description: `${product.name} has been added to your cart.`
            });
        }
    };

    // Filter and sort products
    const filteredProducts = products
        .filter(p => {
            if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
            if (categoryFilter !== 'all' && p.category_id !== categoryFilter) return false;
            if (priceRange.min && p.price < parseFloat(priceRange.min)) return false;
            if (priceRange.max && p.price > parseFloat(priceRange.max)) return false;
            return true;
        })
        .sort((a, b) => {
            switch (sortBy) {
                case 'price_low': return (a.discount_price || a.price) - (b.discount_price || b.price);
                case 'price_high': return (b.discount_price || b.price) - (a.discount_price || a.price);
                case 'name': return a.name.localeCompare(b.name);
                default: return new Date(b.created_at) - new Date(a.created_at);
            }
        });

    const formatPrice = (price) => {
        return new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: 'IDR',
            maximumFractionDigits: 0
        }).format(price);
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div className="container mx-auto px-4 py-8">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900">Products</h1>
                    <p className="text-slate-600">{filteredProducts.length} products available</p>
                </div>

                <Link to="/cart">
                    <Button variant="outline" className="relative">
                        <ShoppingCart className="w-5 h-5 mr-2" />
                        View Cart
                        {itemCount > 0 && (
                            <span className="absolute -top-2 -right-2 w-5 h-5 bg-blue-600 text-white text-xs rounded-full flex items-center justify-center">
                                {itemCount}
                            </span>
                        )}
                    </Button>
                </Link>
            </div>

            {/* Filters */}
            <div className="bg-white rounded-xl border p-4 mb-6 space-y-4">
                <div className="flex flex-wrap gap-4">
                    <Input
                        placeholder="Search products..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="max-w-xs"
                    />

                    <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                        <SelectTrigger className="w-[180px]">
                            <Filter className="w-4 h-4 mr-2" />
                            <SelectValue placeholder="Category" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Categories</SelectItem>
                            {categories.map(cat => (
                                <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    <Select value={sortBy} onValueChange={setSortBy}>
                        <SelectTrigger className="w-[180px]">
                            <SelectValue placeholder="Sort by" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="newest">Newest</SelectItem>
                            <SelectItem value="price_low">Price: Low to High</SelectItem>
                            <SelectItem value="price_high">Price: High to Low</SelectItem>
                            <SelectItem value="name">Name A-Z</SelectItem>
                        </SelectContent>
                    </Select>

                    <div className="flex gap-1">
                        <Button
                            variant={viewMode === 'grid' ? 'default' : 'outline'}
                            size="icon"
                            onClick={() => setViewMode('grid')}
                        >
                            <Grid className="w-4 h-4" />
                        </Button>
                        <Button
                            variant={viewMode === 'list' ? 'default' : 'outline'}
                            size="icon"
                            onClick={() => setViewMode('list')}
                        >
                            <List className="w-4 h-4" />
                        </Button>
                    </div>
                </div>
            </div>

            {/* Products Grid */}
            {filteredProducts.length === 0 ? (
                <div className="text-center py-12 bg-slate-50 rounded-xl">
                    <ShoppingCart className="w-12 h-12 mx-auto text-slate-300 mb-4" />
                    <h3 className="text-lg font-medium text-slate-900">No products found</h3>
                    <p className="text-slate-500">Try adjusting your filters</p>
                </div>
            ) : (
                <div className={`grid gap-6 ${viewMode === 'grid'
                    ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
                    : 'grid-cols-1'
                    }`}>
                    {filteredProducts.map(product => (
                        <div
                            key={product.id}
                            className={`bg-white rounded-xl border overflow-hidden group hover:shadow-lg transition-all ${viewMode === 'list' ? 'flex' : ''
                                }`}
                        >
                            {/* Image */}
                            <div className={`relative overflow-hidden bg-slate-100 ${viewMode === 'list' ? 'w-48 flex-shrink-0' : 'aspect-square'
                                }`}>
                                {product.featured_image ? (
                                    <img
                                        src={product.featured_image}
                                        alt={product.name}
                                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                    />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center">
                                        <ShoppingCart className="w-12 h-12 text-slate-300" />
                                    </div>
                                )}

                                {/* Discount Badge */}
                                {product.discount_price && product.discount_price < product.price && (
                                    <Badge className="absolute top-2 left-2 bg-red-500">
                                        {Math.round((1 - product.discount_price / product.price) * 100)}% OFF
                                    </Badge>
                                )}

                                {/* Stock Badge */}
                                {product.stock <= 0 && (
                                    <Badge variant="secondary" className="absolute top-2 right-2">
                                        Out of Stock
                                    </Badge>
                                )}
                            </div>

                            {/* Content */}
                            <div className="p-4 flex-1 flex flex-col">
                                {product.category && (
                                    <span className="text-xs text-blue-600 font-medium mb-1">
                                        {product.category.name}
                                    </span>
                                )}

                                <Link to={`/products/${product.slug}`}>
                                    <h3 className="font-semibold text-slate-900 hover:text-blue-600 transition-colors line-clamp-2">
                                        {product.name}
                                    </h3>
                                </Link>

                                <div className="mt-2 flex items-center gap-2">
                                    {product.discount_price && product.discount_price < product.price ? (
                                        <>
                                            <span className="text-lg font-bold text-green-600">
                                                {formatPrice(product.discount_price)}
                                            </span>
                                            <span className="text-sm text-slate-400 line-through">
                                                {formatPrice(product.price)}
                                            </span>
                                        </>
                                    ) : (
                                        <span className="text-lg font-bold text-slate-900">
                                            {formatPrice(product.price)}
                                        </span>
                                    )}
                                </div>

                                {product.stock > 0 && product.stock <= 5 && (
                                    <span className="text-xs text-amber-600 mt-1">
                                        Only {product.stock} left!
                                    </span>
                                )}

                                <div className="mt-auto pt-4">
                                    <Button
                                        className="w-full"
                                        disabled={product.stock <= 0}
                                        onClick={() => handleAddToCart(product)}
                                    >
                                        <Plus className="w-4 h-4 mr-2" />
                                        {product.stock <= 0 ? 'Out of Stock' : 'Add to Cart'}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default ProductCatalog;
