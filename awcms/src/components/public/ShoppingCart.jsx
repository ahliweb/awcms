/**
 * Shopping Cart - Display and manage cart items
 */
import { Link, useNavigate } from 'react-router-dom';
import { ShoppingCart, Trash2, Plus, Minus, ArrowLeft, CreditCard, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCart } from '@/contexts/CartContext';
import { useToast } from '@/components/ui/use-toast';

function ShoppingCartPage() {
    const navigate = useNavigate();
    const { toast } = useToast();
    const { items, loading, subtotal, updateItemQuantity, removeItem, clearCart } = useCart();

    const formatPrice = (price) => {
        return new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: 'IDR',
            maximumFractionDigits: 0
        }).format(price);
    };

    const handleQuantityChange = async (itemId, newQuantity) => {
        if (newQuantity < 1) return;
        await updateItemQuantity(itemId, newQuantity);
    };

    const handleRemove = async (itemId, productName) => {
        const success = await removeItem(itemId);
        if (success) {
            toast({
                title: 'Removed',
                description: `${productName} has been removed from your cart.`
            });
        }
    };

    const handleClearCart = async () => {
        if (window.confirm('Are you sure you want to clear your cart?')) {
            await clearCart();
            toast({
                title: 'Cart Cleared',
                description: 'All items have been removed from your cart.'
            });
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div className="container mx-auto px-4 py-8 max-w-4xl">
            {/* Header */}
            <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
                        <ArrowLeft className="w-5 h-5" />
                    </Button>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-900">Shopping Cart</h1>
                        <p className="text-slate-600">{items.length} item(s)</p>
                    </div>
                </div>

                {items.length > 0 && (
                    <Button variant="outline" onClick={handleClearCart} className="text-red-600 hover:text-red-700">
                        <Trash2 className="w-4 h-4 mr-2" />
                        Clear Cart
                    </Button>
                )}
            </div>

            {items.length === 0 ? (
                <div className="text-center py-16 bg-slate-50 rounded-xl">
                    <ShoppingCart className="w-16 h-16 mx-auto text-slate-300 mb-4" />
                    <h3 className="text-xl font-medium text-slate-900 mb-2">Your cart is empty</h3>
                    <p className="text-slate-500 mb-6">Start shopping to add items to your cart.</p>
                    <Link to="/products">
                        <Button>Browse Products</Button>
                    </Link>
                </div>
            ) : (
                <div className="grid gap-6 lg:grid-cols-3">
                    {/* Cart Items */}
                    <div className="lg:col-span-2 space-y-4">
                        {items.map(item => (
                            <div key={item.id} className="bg-white rounded-xl border p-4 flex gap-4">
                                {/* Product Image */}
                                <div className="w-24 h-24 flex-shrink-0 bg-slate-100 rounded-lg overflow-hidden">
                                    {item.product?.featured_image ? (
                                        <img
                                            src={item.product.featured_image}
                                            alt={item.product.name}
                                            className="w-full h-full object-cover"
                                        />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center">
                                            <ShoppingCart className="w-8 h-8 text-slate-300" />
                                        </div>
                                    )}
                                </div>

                                {/* Product Info */}
                                <div className="flex-1 min-w-0">
                                    <Link to={`/products/${item.product?.slug}`}>
                                        <h3 className="font-semibold text-slate-900 hover:text-blue-600 transition-colors truncate">
                                            {item.product?.name}
                                        </h3>
                                    </Link>

                                    <div className="mt-1 text-lg font-bold text-slate-900">
                                        {formatPrice(item.price_snapshot)}
                                    </div>

                                    {/* Quantity Controls */}
                                    <div className="mt-3 flex items-center gap-3">
                                        <div className="flex items-center border rounded-lg">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8"
                                                onClick={() => handleQuantityChange(item.id, item.quantity - 1)}
                                                disabled={item.quantity <= 1}
                                            >
                                                <Minus className="w-4 h-4" />
                                            </Button>
                                            <Input
                                                type="number"
                                                value={item.quantity}
                                                onChange={(e) => handleQuantityChange(item.id, parseInt(e.target.value) || 1)}
                                                className="w-16 h-8 text-center border-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                min="1"
                                            />
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8"
                                                onClick={() => handleQuantityChange(item.id, item.quantity + 1)}
                                                disabled={item.product?.stock && item.quantity >= item.product.stock}
                                            >
                                                <Plus className="w-4 h-4" />
                                            </Button>
                                        </div>

                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="text-red-500 hover:text-red-600 hover:bg-red-50"
                                            onClick={() => handleRemove(item.id, item.product?.name)}
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </Button>
                                    </div>
                                </div>

                                {/* Item Total */}
                                <div className="text-right">
                                    <span className="text-sm text-slate-500">Total</span>
                                    <div className="font-bold text-slate-900">
                                        {formatPrice(item.price_snapshot * item.quantity)}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Order Summary */}
                    <div className="lg:col-span-1">
                        <div className="bg-white rounded-xl border p-6 sticky top-24">
                            <h3 className="text-lg font-semibold text-slate-900 mb-4">Order Summary</h3>

                            <div className="space-y-3 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-slate-600">Subtotal</span>
                                    <span className="font-medium">{formatPrice(subtotal)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-slate-600">Shipping</span>
                                    <span className="text-slate-500 italic">Calculated at checkout</span>
                                </div>
                            </div>

                            <div className="border-t my-4 pt-4">
                                <div className="flex justify-between text-lg font-bold">
                                    <span>Total</span>
                                    <span className="text-green-600">{formatPrice(subtotal)}</span>
                                </div>
                            </div>

                            <Link to="/checkout">
                                <Button className="w-full mt-4" size="lg">
                                    <CreditCard className="w-5 h-5 mr-2" />
                                    Proceed to Checkout
                                </Button>
                            </Link>

                            <Link to="/products" className="block mt-3">
                                <Button variant="outline" className="w-full">
                                    Continue Shopping
                                </Button>
                            </Link>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default ShoppingCartPage;
