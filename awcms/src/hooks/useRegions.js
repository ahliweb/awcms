import { useState, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';

/**
 * Hook for managing administrative regions
 * Provides CRUD operations and hierarchy management
 */
export function useRegions() {
    const [loading, setLoading] = useState(false);
    const { toast } = useToast();

    /**
     * Get regions by level (optionally filtered by parent)
     */
    /**
     * Get regions by level (optionally filtered by parent)
     * Supports pagination and search
     */
    const getRegions = useCallback(async ({ levelId, parentId = null, page = 1, pageSize = 20, searchQuery = '' }) => {
        try {
            setLoading(true);

            let query = supabase
                .from('regions')
                .select(`
          *,
          level:region_levels(key, name, level_order)
        `, { count: 'exact' });

            if (searchQuery && searchQuery.trim().length > 0) {
                query = query.ilike('name', `%${searchQuery}%`);
            } else {
                query = query.order('name');
            }

            if (levelId) {
                query = query.eq('level_id', levelId);
            }

            // Logic for parent/hierarchy navigation (only if not searching, usually)
            // Or allow search within parent? Let's allow global search if query exists.
            if (!searchQuery) {
                if (parentId) {
                    query = query.eq('parent_id', parentId);
                } else if (parentId === null) {
                    query = query.is('parent_id', null);
                }
            }

            // Pagination
            const from = (page - 1) * pageSize;
            const to = from + pageSize - 1;
            query = query.range(from, to);

            const { data, error, count } = await query;

            if (error) throw error;
            return { data, count };
        } catch (error) {
            console.error('Error fetching regions:', error);
            toast.error('Failed to fetch regions');
            return { data: [], count: 0 };
        } finally {
            setLoading(false);
        }
    }, [toast]);

    /**
     * Get all active levels
     */
    const getLevels = useCallback(async () => {
        try {
            const { data, error } = await supabase
                .from('region_levels')
                .select('*')
                .eq('is_active', true)
                .order('level_order');

            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error fetching levels:', error);
            return [];
        }
    }, []);

    /**
     * Create a new region
     */
    const createRegion = useCallback(async (regionData) => {
        try {
            setLoading(true);
            const { data, error } = await supabase
                .from('regions')
                .insert([regionData])
                .select()
                .single();

            if (error) throw error;

            toast.success('Region created successfully');
            return data;
        } catch (error) {
            console.error('Error creating region:', error);
            toast.error('Failed to create region');
            throw error;
        } finally {
            setLoading(false);
        }
    }, [toast]);

    /**
     * Update a region
     */
    const updateRegion = useCallback(async (id, updates) => {
        try {
            setLoading(true);
            const { data, error } = await supabase
                .from('regions')
                .update(updates)
                .eq('id', id)
                .select()
                .single();

            if (error) throw error;

            toast.success('Region updated successfully');
            return data;
        } catch (error) {
            console.error('Error updating region:', error);
            toast.error('Failed to update region');
            throw error;
        } finally {
            setLoading(false);
        }
    }, [toast]);

    /**
     * Delete a region
     */
    const deleteRegion = useCallback(async (id) => {
        try {
            setLoading(true);
            // Soft delete usually preferred, but using hard delete for now based on previous requests
            // Or check if soft delete column exists. Schema has deleted_at.
            const { error } = await supabase
                .from('regions')
                .update({ deleted_at: new Date().toISOString() })
                .eq('id', id);

            if (error) throw error;

            toast.success('Region deleted successfully');
        } catch (error) {
            console.error('Error deleting region:', error);
            toast.error('Failed to delete region');
            throw error;
        } finally {
            setLoading(false);
        }
    }, [toast]);

    /**
     * Search regions
     */
    const searchRegions = useCallback(async (query) => {
        try {
            if (!query || query.length < 2) return [];
            setLoading(true);

            const { data, error } = await supabase
                .from('regions')
                .select('*, level:region_levels(name)')
                .ilike('name', `%${query}%`)
                .limit(20);

            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error searching regions:', error);
            return [];
        } finally {
            setLoading(false);
        }
    }, []);

    return {
        loading,
        getRegions,
        getLevels,
        createRegion,
        updateRegion,
        deleteRegion,
        searchRegions
    };
}
