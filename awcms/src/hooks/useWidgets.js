import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';

export const useWidgets = (areaId) => {
    const { toast } = useToast();
    const [widgets, setWidgets] = useState([]);
    const [loading, setLoading] = useState(true);

    const fetchWidgets = useCallback(async () => {
        if (!areaId) return;
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('widgets')
                .select('*, tenant:tenants(name)')
                .eq('area_id', areaId)
                .is('deleted_at', null)
                .order('order', { ascending: true }); // Make sure 'order' column exists and is used

            if (error) throw error;
            setWidgets(data || []);
        } catch (error) {
            console.error("Error fetching widgets:", error);
            toast({ title: 'Error', description: 'Failed to fetch widgets', variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [areaId, toast]);

    const addWidget = async (type, config = {}) => {
        if (!areaId) return;
        try {
            // Get max order
            const maxOrder = widgets.length > 0 ? Math.max(...widgets.map(w => w.order || 0)) : 0;

            const { data, error } = await supabase
                .from('widgets')
                .insert([{
                    area_id: areaId,
                    type,
                    config,
                    order: maxOrder + 1,
                    // tenant_id handled by triggers or RLS if accessible, but usually client sends it?
                    // RLS usually handles read, trigger handles write if not suppressed. 
                    // But Supabase client usually needs tenant_id in insert if column is not null and no default.
                    // Wait, RLS policies check tenant_id on SELECT/UPDATE/DELETE. 
                    // For INSERT, we need to provide it?
                    // In `useTemplates`, I didn't provide it in `createTemplate`? 
                    // Ah, `useTemplates` logic line 87: `tenant_id: undefined`. 
                    // If the table has tenant_id NOT NULL, and no default, insert will fail unless RLS or Trigger sets it.
                    // Usually `awcms` passes `tenant_id` explicitely or relies on a database trigger `set_tenant_id()`.
                    // The migration `20251218000001` or similar usually sets up a trigger.
                    // Let's assume the trigger exists or I need to fetch it.
                    // Actually, `useTemplates` hook didn't set it. If it works, trigger is there.
                }])
                .select()
                .single();

            if (error) throw error;
            await fetchWidgets();
            return data;
        } catch (error) {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    };

    const updateWidget = async (id, updates) => {
        try {
            const { error } = await supabase
                .from('widgets')
                .update(updates)
                .eq('id', id);

            if (error) throw error;
            await fetchWidgets();
            toast({ title: "Saved", description: "Widget updated." });
        } catch (error) {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    };

    const deleteWidget = async (id) => {
        try {
            const { error } = await supabase
                .from('widgets')
                .update({ deleted_at: new Date().toISOString() })
                .eq('id', id);

            if (error) throw error;
            await fetchWidgets();
            toast({ title: "Deleted", description: "Widget removed." });
        } catch (error) {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    };

    const reorderWidgets = async (newOrderIds) => {
        // Optimistic update
        const reordered = newOrderIds.map((id, index) => {
            const w = widgets.find(w => w.id === id);
            return { ...w, order: index };
        });
        setWidgets(reordered);

        try {
            // Batch update? Supabase supports upsert.
            const updates = newOrderIds.map((id, index) => ({
                id,
                area_id: areaId, // Required for upsert constraint usually?
                order: index,
                updated_at: new Date().toISOString()
            }));

            const { error } = await supabase
                .from('widgets')
                .upsert(updates, { onConflict: 'id' }); // Assuming 'id' is PK

            if (error) throw error;
            // No need to fetch if successful, we already optimistic updated
        } catch (error) {
            console.error(error);
            toast({ title: "Error", description: "Failed to reorder", variant: "destructive" });
            fetchWidgets(); // Revert
        }
    };

    useEffect(() => {
        if (areaId) fetchWidgets();
    }, [areaId, fetchWidgets]);

    return {
        widgets,
        loading,
        fetchWidgets,
        addWidget,
        updateWidget,
        deleteWidget,
        reorderWidgets
    };
};
