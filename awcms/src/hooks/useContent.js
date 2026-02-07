import { useState, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useTenant } from '@/contexts/TenantContext';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { usePermissions } from '@/contexts/PermissionContext';
import { useToast } from '@/components/ui/use-toast';

/**
 * Hook for managing Content (Pages, Blogs, etc.)
 * Centralizes CRUD operations and enforcing Tenant/RLS constraints.
 */
export function useContent(contentType = 'page') {
    const { currentTenant } = useTenant();
    const { user } = useAuth();
    const { toast } = useToast();
    const { hasPermission } = usePermissions();
    const [loading, setLoading] = useState(false);

    // Map contentType to table name and permission resource
    const config = {
        table: contentType === 'blog' ? 'blogs' : 'pages',
        permission: contentType === 'blog' ? 'blog' : 'pages',
        tagTable: contentType === 'blog' ? 'blog_tags' : 'page_tags',
        tagKey: contentType === 'blog' ? 'blog_id' : 'page_id'
    };

    /**
     * Fetch Categories for the current tenant and content type
     */
    const fetchCategories = useCallback(async () => {
        if (!currentTenant?.id) return [];

        try {
            // Logic: fetch categories that match the type (e.g. 'blog') OR are generic 'content'
            // and belong to the current tenant.
            // RLS should handle the tenant filter, but adding it explicitly is safer for the query planner.
            const categoryType = contentType === 'blog' ? 'blog' : 'page';
            
            const { data, error } = await supabase
                .from('categories')
                .select('id, name')
                .eq('tenant_id', currentTenant.id)
                .or(`type.eq.${categoryType},type.eq.content`);

            if (error) throw error;
            return data || [];
        } catch (error) {
            console.error('Error fetching categories:', error);
            toast({ 
                variant: 'destructive', 
                title: 'Error fetching categories', 
                description: error.message 
            });
            return [];
        }
    }, [currentTenant, contentType, toast]);

    /**
     * Save Content (Create or Update)
     */
    const saveContent = async (data, isEditMode = false, id = null) => {
        if (!currentTenant?.id) {
            toast({ variant: 'destructive', title: 'No tenant context' });
            return null;
        }

        const permissionAction = isEditMode ? 'update' : 'create';
        if (!hasPermission(`tenant.${config.permission}.${permissionAction}`)) {
            toast({ variant: 'destructive', title: 'Permission Denied' });
            return null;
        }

        setLoading(true);
        try {
            // Prepare payload
            const payload = {
                ...data,
                tenant_id: currentTenant.id,
                updated_at: new Date().toISOString()
            };

            if (!isEditMode) {
                payload.created_by = user?.id;
            } else {
                // Ensure we don't accidentally overwrite tenant_id with something else, 
                // though we set it above. 
                // Remove readonly fields if necessary, but Supabase usually handles ignoring extra fields if not in schema?
                // Actually, strict mode might fail.
            }
            
            // Extract tags if present (handled separately)
            const tags = payload.tags;
            delete payload.tags; // Don't send array to main table

            let resultId = id;

            if (isEditMode && id) {
                const { error } = await supabase
                    .from(config.table)
                    .update(payload)
                    .eq('id', id)
                    .eq('tenant_id', currentTenant.id); // Extra safety

                if (error) throw error;
            } else {
                const { data: newData, error } = await supabase
                    .from(config.table)
                    .insert([payload])
                    .select('id')
                    .single();

                if (error) throw error;
                resultId = newData.id;
            }

            // Handle Tags
            if (tags && Array.isArray(tags) && resultId) {
                // 1. Delete existing
                await supabase
                    .from(config.tagTable)
                    .delete()
                    .eq(config.tagKey, resultId); // RLS handles tenant check

                // 2. Insert new
                if (tags.length > 0) {
                     const tagInserts = tags.map(tagId => ({
                        [config.tagKey]: resultId,
                        tag_id: tagId,
                        tenant_id: currentTenant.id,
                        created_by: user?.id
                    }));
                    
                    const { error: tagError } = await supabase
                        .from(config.tagTable)
                        .insert(tagInserts);
                        
                    if (tagError) console.error('Tag save error:', tagError);
                }
            }

            toast({ title: "Success", description: "Content saved successfully" });
            return resultId;

        } catch (error) {
            console.error('Save error:', error);
            toast({ 
                variant: 'destructive', 
                title: 'Error saving content', 
                description: error.message 
            });
            return null;
        } finally {
            setLoading(false);
        }
    };

    return {
        fetchCategories,
        saveContent,
        loading
    };
}
