/**
 * Cart Context - Global shopping cart state management
 * Supports both authenticated users (database) and guests (localStorage)
 */
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { v4 as uuidv4 } from 'uuid';

const CartContext = createContext(null);

const SESSION_ID_KEY = 'awcms_session_id';

export function CartProvider({ children }) {
    const { user } = useAuth();
    const { currentTenant } = useTenant();
    const [cart, setCart] = useState(null);
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);

    // Get or create session ID for guests
    const getSessionId = useCallback(() => {
        let sessionId = localStorage.getItem(SESSION_ID_KEY);
        if (!sessionId) {
            sessionId = uuidv4();
            localStorage.setItem(SESSION_ID_KEY, sessionId);
        }
        return sessionId;
    }, []);

    // Fetch cart from database
    const fetchCart = useCallback(async () => {
        if (!currentTenant?.id) return;

        setLoading(true);
        try {
            let query = supabase
                .from('carts')
                .select(`
          *,
          cart_items (
            *,
            product:products (id, name, slug, price, discount_price, featured_image, stock, is_available, shipping_cost, weight)
          )
        `)
                .eq('tenant_id', currentTenant.id)
                .is('cart_items.deleted_at', null)
                .eq('status', 'active')
                .order('created_at', { ascending: false })
                .limit(1);

            if (user?.id) {
                query = query.eq('user_id', user.id);
            } else {
                query = query.eq('session_id', getSessionId());
            }

            const { data, error } = await query.maybeSingle();

            if (error) throw error;

            if (data) {
                setCart(data);
                setItems(data.cart_items || []);
            } else {
                setCart(null);
                setItems([]);
            }
        } catch (error) {
            console.error('Error fetching cart:', error);
        } finally {
            setLoading(false);
        }
    }, [user?.id, currentTenant?.id, getSessionId]);

    // Create new cart
    const createCart = async () => {
        if (!currentTenant?.id) return null;

        const cartData = {
            tenant_id: currentTenant.id,
            status: 'active',
            ...(user?.id ? { user_id: user.id } : { session_id: getSessionId() })
        };

        const { data, error } = await supabase
            .from('carts')
            .insert(cartData)
            .select()
            .single();

        if (error) throw error;
        setCart(data);
        return data;
    };

    // Add item to cart
    const addItem = async (product, quantity = 1) => {
        try {
            let currentCart = cart;
            if (!currentCart) {
                currentCart = await createCart();
            }

            const { data: existingRow, error: existingError } = await supabase
                .from('cart_items')
                .select('id, quantity, deleted_at')
                .eq('cart_id', currentCart.id)
                .eq('product_id', product.id)
                .maybeSingle();

            if (existingError) throw existingError;

            if (existingRow) {
                const baseQuantity = existingRow.deleted_at ? 0 : existingRow.quantity;
                const newQuantity = baseQuantity + quantity;
                const { data, error } = await supabase
                    .from('cart_items')
                    .update({
                        quantity: newQuantity,
                        updated_at: new Date().toISOString(),
                        deleted_at: null
                    })
                    .eq('id', existingRow.id)
                    .select(`
            *,
            product:products (id, name, slug, price, discount_price, featured_image, stock, is_available, shipping_cost, weight)
          `)
                    .single();

                if (error) throw error;
                setItems(prev => {
                    const exists = prev.find(item => item.id === data.id);
                    if (exists) {
                        return prev.map(item => item.id === data.id ? data : item);
                    }
                    return [...prev, data];
                });
            } else {
                const { data, error } = await supabase
                    .from('cart_items')
                    .insert({
                        cart_id: currentCart.id,
                        product_id: product.id,
                        quantity,
                        price_snapshot: product.discount_price || product.price
                    })
                    .select(`
            *,
            product:products (id, name, slug, price, discount_price, featured_image, stock, is_available, shipping_cost, weight)
          `)
                    .single();

                if (error) throw error;
                setItems(prev => [...prev, data]);
            }
            return true;
        } catch (error) {
            console.error('Error adding item to cart:', error);
            return false;
        }
    };

    // Update item quantity
    const updateItemQuantity = async (itemId, quantity) => {
        try {
            if (quantity <= 0) {
                return removeItem(itemId);
            }

            const { data, error } = await supabase
                .from('cart_items')
                .update({ quantity, updated_at: new Date().toISOString(), deleted_at: null })
                .eq('id', itemId)
                .select(`
          *,
          product:products (id, name, slug, price, discount_price, featured_image, stock, is_available, shipping_cost, weight)
        `)
                .single();

            if (error) throw error;
            setItems(prev => prev.map(item => item.id === itemId ? data : item));
            return true;
        } catch (error) {
            console.error('Error updating item quantity:', error);
            return false;
        }
    };

    // Remove item from cart
    const removeItem = async (itemId) => {
        try {
            const { error } = await supabase
                .from('cart_items')
                .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
                .eq('id', itemId);

            if (error) throw error;
            setItems(prev => prev.filter(item => item.id !== itemId));
            return true;
        } catch (error) {
            console.error('Error removing item:', error);
            return false;
        }
    };

    // Clear cart
    const clearCart = async () => {
        if (!cart) return;

        try {
            await supabase
                .from('cart_items')
                .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
                .eq('cart_id', cart.id)
                .is('deleted_at', null);
            setItems([]);
            return true;
        } catch (error) {
            console.error('Error clearing cart:', error);
            return false;
        }
    };

    // Convert cart to order (after checkout)
    const convertToOrder = async () => {
        if (!cart) return null;

        try {
            await supabase
                .from('carts')
                .update({ status: 'converted', updated_at: new Date().toISOString() })
                .eq('id', cart.id);

            setCart(null);
            setItems([]);
            return true;
        } catch (error) {
            console.error('Error converting cart:', error);
            return false;
        }
    };

    // Calculate totals
    const subtotal = items.reduce((sum, item) => {
        return sum + (item.price_snapshot * item.quantity);
    }, 0);

    const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);

    // Fetch cart on mount and when user changes
    useEffect(() => {
        fetchCart();
    }, [fetchCart]);

    // Merge guest cart when user logs in
    useEffect(() => {
        if (user?.id && cart && !cart.user_id && cart.session_id) {
            // Transfer guest cart to user
            supabase
                .from('carts')
                .update({ user_id: user.id, session_id: null })
                .eq('id', cart.id)
                .then(() => fetchCart());
        }
    }, [user?.id, cart, fetchCart]);

    const value = {
        cart,
        items,
        loading,
        itemCount,
        subtotal,
        addItem,
        updateItemQuantity,
        removeItem,
        clearCart,
        convertToOrder,
        refreshCart: fetchCart
    };

    return (
        <CartContext.Provider value={value}>
            {children}
        </CartContext.Provider>
    );
}

export function useCart() {
    const context = useContext(CartContext);
    if (!context) {
        throw new Error('useCart must be used within a CartProvider');
    }
    return context;
}

export default CartContext;
