/**
 * Checkout Page - Multi-step checkout with Xendit payment
 */
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CreditCard, Truck, CheckCircle2, Loader2, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useCart } from '@/contexts/CartContext';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';

function CheckoutPage() {
    const navigate = useNavigate();
    const { toast } = useToast();
    const { user } = useAuth();
    const { currentTenant } = useTenant();
    const { items, subtotal, convertToOrder } = useCart();

    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [paymentMethods, setPaymentMethods] = useState([]);

    const [formData, setFormData] = useState({
        // Customer Info
        customer_name: user?.user_metadata?.full_name || '',
        customer_email: user?.email || '',
        customer_phone: '',

        // Shipping Address
        shipping_address: '',
        shipping_city: '',
        shipping_province: '',
        shipping_postal_code: '',

        // Payment
        payment_method_id: '',

        // Notes
        notes: ''
    });

    const fetchPaymentMethods = React.useCallback(async () => {
        if (!currentTenant?.id) return;

        try {
            const { data } = await supabase
                .from('payment_methods')
                .select('*')
                .eq('tenant_id', currentTenant.id)
                .eq('is_active', true)
                .is('deleted_at', null)
                .order('sort_order', { ascending: true });

            setPaymentMethods(data || []);
            if (data && data.length > 0) {
                setFormData(prev => ({ ...prev, payment_method_id: data[0].id }));
            }
        } catch (error) {
            console.error('Error fetching payment methods:', error);
        }
    }, [currentTenant?.id]);

    useEffect(() => {
        if (items.length === 0) {
            navigate('/cart');
        }
        fetchPaymentMethods();
    }, [items, navigate, fetchPaymentMethods]);

    const handleChange = (field, value) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const validateStep1 = () => {
        if (!formData.customer_name || !formData.customer_email || !formData.customer_phone) {
            toast({
                variant: 'destructive',
                title: 'Required Fields',
                description: 'Please fill in all customer information.'
            });
            return false;
        }
        return true;
    };

    const validateStep2 = () => {
        if (!formData.shipping_address || !formData.shipping_city || !formData.shipping_province) {
            toast({
                variant: 'destructive',
                title: 'Required Fields',
                description: 'Please fill in shipping address.'
            });
            return false;
        }
        return true;
    };

    const handleNextStep = () => {
        if (step === 1 && !validateStep1()) return;
        if (step === 2 && !validateStep2()) return;
        setStep(step + 1);
    };

    const handlePlaceOrder = async () => {
        if (!formData.payment_method_id) {
            toast({
                variant: 'destructive',
                title: 'Payment Method Required',
                description: 'Please select a payment method.'
            });
            return;
        }

        setLoading(true);
        try {
            // 1. Create order
            const calculatedShippingCost = items.reduce((acc, item) => {
                return acc + ((item.product.shipping_cost || 0) * item.quantity);
            }, 0);

            const orderData = {
                user_id: user?.id,
                tenant_id: currentTenant.id,
                subtotal: subtotal,
                shipping_cost: calculatedShippingCost,
                total_amount: subtotal + calculatedShippingCost,
                status: 'pending',
                payment_status: 'unpaid',
                payment_method: paymentMethods.find(pm => pm.id === formData.payment_method_id)?.name,
                shipping_address: {
                    street: formData.shipping_address,
                    city: formData.shipping_city,
                    province: formData.shipping_province,
                    postal_code: formData.shipping_postal_code,
                },
                notes: formData.notes,
                order_number: `ORD-${Date.now()}`
            };

            const { data: order, error: orderError } = await supabase
                .from('orders')
                .insert(orderData)
                .select()
                .single();

            if (orderError) throw orderError;

            // 2. Create order items
            const orderItems = items.map(item => ({
                order_id: order.id,
                product_id: item.product_id,
                quantity: item.quantity,
                price: item.price_snapshot
            }));

            const { error: itemsError } = await supabase
                .from('order_items')
                .insert(orderItems);

            if (itemsError) throw itemsError;

            // 3. Create payment record
            const paymentData = {
                order_id: order.id,
                payment_method_id: formData.payment_method_id,
                amount: subtotal + calculatedShippingCost, // Payment amount should include shipping
                status: 'pending',
                tenant_id: currentTenant.id
            };

            const { data: payment, error: paymentError } = await supabase
                .from('payments')
                .insert(paymentData)
                .select()
                .single();

            if (paymentError) throw paymentError;

            // 4. Initialize Xendit payment (if online payment)
            const selectedMethod = paymentMethods.find(pm => pm.id === formData.payment_method_id);
            if (selectedMethod?.type === 'xendit') {
                // Call edge function to create invoice
                const { data: invoiceData, error: invoiceError } = await supabase.functions.invoke('xendit-payment', {
                    body: {
                        order_id: order.id,
                        payment_id: payment.id,
                        amount: subtotal + calculatedShippingCost, // Xendit amount should include shipping
                        customer_name: formData.customer_name,
                        customer_email: formData.customer_email,
                        customer_phone: formData.customer_phone,
                        description: `Order #${order.order_number}`
                    }
                });

                if (invoiceError) throw invoiceError;

                // Redirect to Xendit invoice page
                if (invoiceData?.invoice_url) {
                    window.location.href = invoiceData.invoice_url;
                    return;
                }
            }

            // 5. Convert cart
            await convertToOrder();

            // 6. Navigate to success page
            toast({
                title: 'Order Placed!',
                description: `Order #${order.order_number} has been created.`
            });

            navigate(`/order-confirmation/${order.id}`);
        } catch (error) {
            console.error('Checkout error:', error);
            toast({
                variant: 'destructive',
                title: 'Checkout Failed',
                description: error.message || 'Failed to place order. Please try again.'
            });
        } finally {
            setLoading(false);
        }
    };

    const formatPrice = (price) => {
        return new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: 'IDR',
            maximumFractionDigits: 0
        }).format(price);
    };

    const steps = [
        { num: 1, title: 'Customer Info', icon: User },
        { num: 2, title: 'Shipping', icon: Truck },
        { num: 3, title: 'Payment', icon: CreditCard }
    ];

    const totalShippingCost = items.reduce((acc, item) => acc + ((item.product?.shipping_cost || 0) * item.quantity), 0);
    const totalAmount = subtotal + totalShippingCost;

    return (
        <div className="container mx-auto px-4 py-8 max-w-5xl">
            {/* Header */}
            <div className="flex items-center gap-4 mb-8">
                <Button variant="ghost" size="icon" onClick={() => navigate('/cart')}>
                    <ArrowLeft className="w-5 h-5" />
                </Button>
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">Checkout</h1>
                    <p className="text-slate-600">Complete your purchase</p>
                </div>
            </div>

            {/* Progress Steps */}
            <div className="mb-8">
                <div className="flex items-center justify-center gap-4">
                    {steps.map((s, idx) => (
                        <React.Fragment key={s.num}>
                            <div className={`flex items-center gap-2 ${step >= s.num ? 'text-blue-600' : 'text-slate-400'}`}>
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 ${step >= s.num ? 'border-blue-600 bg-blue-50' : 'border-slate-300'
                                    }`}>
                                    {step > s.num ? <CheckCircle2 className="w-5 h-5" /> : <s.icon className="w-5 h-5" />}
                                </div>
                                <span className="font-medium hidden sm:block">{s.title}</span>
                            </div>
                            {idx < steps.length - 1 && (
                                <div className={`h-0.5 w-12 sm:w-24 ${step > s.num ? 'bg-blue-600' : 'bg-slate-300'}`} />
                            )}
                        </React.Fragment>
                    ))}
                </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
                {/* Form */}
                <div className="lg:col-span-2 bg-white rounded-xl border p-6">
                    {/* Step 1: Customer Info */}
                    {step === 1 && (
                        <div className="space-y-4">
                            <h3 className="text-lg font-semibold mb-4">Customer Information</h3>

                            <div className="grid gap-4 sm:grid-cols-2">
                                <div>
                                    <Label htmlFor="customer_name">Full Name *</Label>
                                    <Input
                                        id="customer_name"
                                        value={formData.customer_name}
                                        onChange={(e) => handleChange('customer_name', e.target.value)}
                                        placeholder="John Doe"
                                    />
                                </div>
                                <div>
                                    <Label htmlFor="customer_email">Email *</Label>
                                    <Input
                                        type="email"
                                        id="customer_email"
                                        value={formData.customer_email}
                                        onChange={(e) => handleChange('customer_email', e.target.value)}
                                        placeholder="john@example.com"
                                    />
                                </div>
                            </div>

                            <div>
                                <Label htmlFor="customer_phone">Phone Number *</Label>
                                <Input
                                    id="customer_phone"
                                    value={formData.customer_phone}
                                    onChange={(e) => handleChange('customer_phone', e.target.value)}
                                    placeholder="+62 812 3456 7890"
                                />
                            </div>

                            <div className="pt-4">
                                <Button onClick={handleNextStep} className="w-full">
                                    Continue to Shipping
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* Step 2: Shipping */}
                    {step === 2 && (
                        <div className="space-y-4">
                            <h3 className="text-lg font-semibold mb-4">Shipping Address</h3>

                            <div>
                                <Label htmlFor="shipping_address">Street Address *</Label>
                                <Textarea
                                    id="shipping_address"
                                    value={formData.shipping_address}
                                    onChange={(e) => handleChange('shipping_address', e.target.value)}
                                    placeholder="Jl. Example No. 123"
                                    rows={3}
                                />
                            </div>

                            <div className="grid gap-4 sm:grid-cols-2">
                                <div>
                                    <Label htmlFor="shipping_city">City *</Label>
                                    <Input
                                        id="shipping_city"
                                        value={formData.shipping_city}
                                        onChange={(e) => handleChange('shipping_city', e.target.value)}
                                        placeholder="Jakarta"
                                    />
                                </div>
                                <div>
                                    <Label htmlFor="shipping_province">Province *</Label>
                                    <Input
                                        id="shipping_province"
                                        value={formData.shipping_province}
                                        onChange={(e) => handleChange('shipping_province', e.target.value)}
                                        placeholder="DKI Jakarta"
                                    />
                                </div>
                            </div>

                            <div>
                                <Label htmlFor="shipping_postal_code">Postal Code</Label>
                                <Input
                                    id="shipping_postal_code"
                                    value={formData.shipping_postal_code}
                                    onChange={(e) => handleChange('shipping_postal_code', e.target.value)}
                                    placeholder="12345"
                                />
                            </div>

                            <div className="flex gap-2 pt-4">
                                <Button variant="outline" onClick={() => setStep(1)} className="flex-1">
                                    Back
                                </Button>
                                <Button onClick={handleNextStep} className="flex-1">
                                    Continue to Payment
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* Step 3: Payment */}
                    {step === 3 && (
                        <div className="space-y-4">
                            <h3 className="text-lg font-semibold mb-4">Payment Method</h3>

                            <RadioGroup
                                value={formData.payment_method_id}
                                onValueChange={(value) => handleChange('payment_method_id', value)}
                            >
                                {paymentMethods.map(method => (
                                    <div key={method.id} className="flex items-center space-x-3 border rounded-lg p-4 hover:bg-slate-50">
                                        <RadioGroupItem value={method.id} id={method.id} />
                                        <Label htmlFor={method.id} className="flex-1 cursor-pointer">
                                            <div className="font-medium">{method.name}</div>
                                            {method.description && (
                                                <div className="text-sm text-slate-500">{method.description}</div>
                                            )}
                                        </Label>
                                    </div>
                                ))}
                            </RadioGroup>

                            {paymentMethods.length === 0 && (
                                <div className="text-center py-8 text-slate-500">
                                    No payment methods available. Please contact support.
                                </div>
                            )}

                            <div>
                                <Label htmlFor="notes">Order Notes (Optional)</Label>
                                <Textarea
                                    id="notes"
                                    value={formData.notes}
                                    onChange={(e) => handleChange('notes', e.target.value)}
                                    placeholder="Any special instructions..."
                                    rows={3}
                                />
                            </div>

                            <div className="flex gap-2 pt-4">
                                <Button variant="outline" onClick={() => setStep(2)} className="flex-1">
                                    Back
                                </Button>
                                <Button
                                    onClick={handlePlaceOrder}
                                    disabled={loading || paymentMethods.length === 0}
                                    className="flex-1"
                                >
                                    {loading ? (
                                        <>
                                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                            Processing...
                                        </>
                                    ) : (
                                        <>
                                            <CreditCard className="w-4 h-4 mr-2" />
                                            Place Order
                                        </>
                                    )}
                                </Button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Order Summary */}
                <div className="lg:col-span-1">
                    <div className="bg-white rounded-xl border p-6 sticky top-24">
                        <h3 className="text-lg font-semibold mb-4">Order Summary</h3>

                        <div className="space-y-3 mb-4">
                            {items.map(item => (
                                <div key={item.id} className="flex justify-between text-sm">
                                    <span className="text-slate-600">
                                        {item.product?.name} <span className="text-slate-400">x{item.quantity}</span>
                                    </span>
                                    <span className="font-medium">
                                        {formatPrice(item.price_snapshot * item.quantity)}
                                    </span>
                                </div>
                            ))}
                        </div>

                        <div className="border-t pt-4 space-y-2">
                            <div className="flex justify-between text-sm">
                                <span className="text-slate-600">Subtotal</span>
                                <span className="font-medium">{formatPrice(subtotal)}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-slate-600">Shipping</span>
                                <span className="font-medium">
                                    {totalShippingCost > 0 ? formatPrice(totalShippingCost) : 'Free'}
                                </span>
                            </div>
                            <div className="border-t pt-2 flex justify-between text-lg font-bold">
                                <span>Total</span>
                                <span className="text-green-600">{formatPrice(totalAmount)}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default CheckoutPage;
