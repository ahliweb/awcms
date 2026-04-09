import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { usePermissions } from '@/contexts/PermissionContext';

export const useWidgets = (areaId) => {
    const { toast } = useToast();
    const { tenantId } = usePermissions();
    const [widgets, setWidgets] = useState([]);
    const [loading, setLoading] = useState(true);

    const fetchWidgets = useCallback(async () => {
        if (!areaId || !tenantId) {
            setWidgets([]);
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('widgets')
                .select('*, tenant:tenants(name)')
                .eq('area_id', areaId)
                .eq('tenant_id', tenantId)
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
    }, [areaId, tenantId, toast]);

    const addWidget = async (type, config = {}) => {
        if (!areaId || !tenantId) return;
        try {
            // Get max order
            const maxOrder = widgets.length > 0 ? Math.max(...widgets.map(w => w.order || 0)) : 0;

            const { data, error } = await supabase
                .from('widgets')
                .insert([{
                    area_id: areaId,
                    tenant_id: tenantId,
                    type,
                    config,
                    order: maxOrder + 1,
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
            let query = supabase
                .from('widgets')
                .update(updates)
                .eq('id', id);

            if (tenantId) {
                query = query.eq('tenant_id', tenantId);
            }

            const { error } = await query;

            if (error) throw error;
            await fetchWidgets();
            toast({ title: "Saved", description: "Widget updated." });
        } catch (error) {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    };

    const deleteWidget = async (id) => {
        try {
            let query = supabase
                .from('widgets')
                .update({ deleted_at: new Date().toISOString() })
                .eq('id', id);

            if (tenantId) {
                query = query.eq('tenant_id', tenantId);
            }

            const { error } = await query;

            if (error) throw error;
            await fetchWidgets();
            toast({ title: "Deleted", description: "Widget removed." });
        } catch (error) {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    };

    const reorderWidgets = async (newOrderIds) => {
        if (!tenantId) return;
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
                tenant_id: tenantId,
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
        if (areaId && tenantId) fetchWidgets();
    }, [areaId, tenantId, fetchWidgets]);

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
