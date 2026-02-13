
import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@/lib/customSupabaseClient';
import { ShoppingBag, Tag, ArrowLeft, Package, Truck, CheckCircle, XCircle } from 'lucide-react';
import SeoHelmet from '@/components/public/SeoHelmet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

function PublicProductDetail() {
    const { slug } = useParams();
    const [product, setProduct] = useState(null);
    const [relatedProducts, setRelatedProducts] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchDetail = async () => {
            setLoading(true);
            // Fetch Product
            const { data, error } = await supabase
                .from('products')
                .select(`*, categories(name), product_types(name, icon)`)
                .eq('slug', slug)
                .eq('status', 'active')
                .maybeSingle();

            if (!error && data) {
                setProduct(data);
                // Fetch Related
                if (data.category_id) {
                    const { data: related } = await supabase
                        .from('products')
                        .select('id, name, slug, price, images')
                        .eq('category_id', data.category_id)
                        .neq('id', data.id)
                        .eq('status', 'active')
                        .limit(3);
                    setRelatedProducts(related || []);
                }
            }
            setLoading(false);
        };
        fetchDetail();
    }, [slug]);

    if (loading) return <div className="py-20 text-center">Loading product...</div>;

    if (!product) return (
        <div className="py-20 text-center">
            <h2 className="text-2xl font-bold text-slate-800">Product Not Found</h2>
            <Link to="/products" className="text-blue-600 mt-4 inline-block">Back to products</Link>
        </div>
    );

    const isDiscounted = product.discount_price && product.discount_price < product.price;
    const finalPrice = isDiscounted ? product.discount_price : product.price;
    const hasStock = product.stock > 0;

    return (
        <div className="container mx-auto px-4 py-12">
            <SeoHelmet
                type="product_detail"
                id={product.id}
                defaultTitle={`${product.name} | Products`}
                defaultDescription={product.description.substring(0, 150)}
            />

            <Link to="/products" className="inline-flex items-center text-sm text-slate-500 hover:text-blue-600 transition-colors mb-8">
                <ArrowLeft className="w-4 h-4 mr-1" /> Back to Products
            </Link>

            <div className="grid lg:grid-cols-2 gap-12 mb-16">
                {/* Image Section */}
                <div className="bg-slate-50 rounded-2xl h-[400px] lg:h-[500px] flex items-center justify-center border border-slate-200">
                    {product.images && product.images.length > 0 ? (
                        <img src={product.images[0]} alt={product.name} className="max-w-full max-h-full object-contain" />
                    ) : (
                        <Package className="w-32 h-32 text-slate-200" />
                    )}
                </div>

                {/* Content Section */}
                <div className="flex flex-col">
                    <div className="flex items-center gap-2 mb-4">
                        {product.categories && <Badge variant="outline" className="text-blue-600 border-blue-200 bg-blue-50">{product.categories.name}</Badge>}
                        {product.product_types && <Badge variant="secondary" className="flex items-center gap-1"><Tag className="w-3 h-3" /> {product.product_types.name}</Badge>}
                    </div>

                    <h1 className="text-3xl lg:text-4xl font-bold text-slate-900 mb-4">{product.name}</h1>

                    <div className="flex items-end gap-4 mb-6">
                        <span className="text-4xl font-bold text-slate-900">${finalPrice}</span>
                        {isDiscounted && <span className="text-xl text-slate-400 line-through mb-1">${product.price}</span>}
                    </div>

                    <div className="flex items-center gap-2 mb-8 text-sm">
                        {hasStock && product.is_available ? (
                            <span className="flex items-center gap-1 text-green-600 font-medium bg-green-50 px-3 py-1 rounded-full">
                                <CheckCircle className="w-4 h-4" /> In Stock ({product.stock} units)
                            </span>
                        ) : (
                            <span className="flex items-center gap-1 text-red-600 font-medium bg-red-50 px-3 py-1 rounded-full">
                                <XCircle className="w-4 h-4" /> Out of Stock
                            </span>
                        )}
                        {product.shipping_cost > 0 && (
                            <span className="flex items-center gap-1 text-slate-600 bg-slate-100 px-3 py-1 rounded-full">
                                <Truck className="w-4 h-4" /> Shipping: ${product.shipping_cost}
                            </span>
                        )}
                    </div>

                    <div className="prose prose-slate mb-8 flex-1">
                        <p className="text-lg leading-relaxed text-slate-600">{product.description}</p>
                    </div>

                    <div className="pt-8 border-t border-slate-100 mt-auto">
                        <Button
                            size="lg"
                            className="w-full md:w-auto text-lg px-8"
                            disabled={!hasStock || !product.is_available}
                        >
                            <ShoppingBag className="w-5 h-5 mr-2" />
                            {hasStock ? "Add to Cart" : "Unavailable"}
                        </Button>
                    </div>
                </div>
            </div>

            {/* Related Products */}
            {relatedProducts.length > 0 && (
                <div className="mt-20">
                    <h3 className="text-2xl font-bold text-slate-900 mb-8">Related Products</h3>
                    <div className="grid md:grid-cols-3 gap-6">
                        {relatedProducts.map(item => (
                            <Link key={item.id} to={`/products/${item.slug}`} className="group block">
                                <div className="bg-white rounded-xl border border-slate-200 p-4 hover:shadow-md transition-all">
                                    <div className="bg-slate-50 h-48 rounded-lg mb-4 flex items-center justify-center">
                                        <Package className="w-12 h-12 text-slate-300" />
                                    </div>
                                    <h4 className="font-bold text-slate-900 group-hover:text-blue-600 transition-colors">{item.name}</h4>
                                    <div className="text-slate-600 mt-1">${item.price}</div>
                                </div>
                            </Link>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

export default PublicProductDetail;
