import { useState, useEffect } from 'react';
import { Render } from '@puckeditor/core';
import { supabase } from '@/lib/customSupabaseClient';
import { puckConfig } from '@/components/visual-builder/config';
import { usePermissions } from '@/contexts/PermissionContext';

/**
 * DynamicTemplate
 * Fetches and renders a system page template (Header, Footer, Homepage, etc.)
 * 
 * @param {string} type - The page_type to fetch (header, footer, homepage)
 * @param {React.Component} fallback - Component to render if no template found
 * @param {object} context - Additional context to pass to Puck
 */
const DynamicTemplate = ({ type, fallback: Fallback, context = {} }) => {
    const [template, setTemplate] = useState(null);
    const [loading, setLoading] = useState(true);
    const { hasAnyPermission } = usePermissions();

    // Allow viewing draft system templates if user can edit visual pages
    const canViewDrafts = hasAnyPermission(['edit_visual_pages', 'manage_pages', 'super_admin']);

    useEffect(() => {
        const fetchTemplate = async () => {
            // CRITICAL: Check for Tenant Context
            if (!context.tenant?.id) {
                // If no tenant context, cannot fetch template. 
                // Wait provided logic handles it or Fallback renders?
                // For now, let's stop loading if no tenant (e.g. still resolving)
                if (context.tenant === undefined) return; // Wait
                setLoading(false);
                return;
            }

            try {
                const statusFilter = canViewDrafts ? ['published', 'draft'] : ['published'];

                // Explicit Tenant Filtering for System Pages
                const { data, error } = await supabase
                    .from('pages')
                    .select('*')
                    .eq('page_type', type)
                    .eq('tenant_id', context.tenant.id) // Filter by Tenant
                    .in('status', statusFilter)
                    .is('deleted_at', null)
                    .order('updated_at', { ascending: false }) // Get latest
                    .limit(1)
                    .maybeSingle();

                if (error && error.code !== 'PGRST116') {
                    console.error(`Error fetching ${type} template:`, error);
                }

                if (data) {
                    const contentToRender = (data.status === 'draft' && canViewDrafts)
                        ? (data.content_draft || data.content_published)
                        : data.content_published;

                    if (contentToRender) {
                        setTemplate({ ...data, content_rendered: contentToRender });
                    }
                }
            } catch (err) {
                console.error(`Unexpected error in DynamicTemplate (${type}):`, err);
            } finally {
                setLoading(false);
            }
        };

        fetchTemplate();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [type, canViewDrafts, context.tenant?.id]); // Re-fetch on tenant change

    if (loading) {
        return null;
    }

    if (!template) {
        return Fallback ? <Fallback /> : null;
    }

    return (
        <div className={`dynamic-template-${type} relative group`}>
            {/* Visual Indicator for Admin when viewing Draft/Custom Template */}
            {canViewDrafts && template.status === 'draft' && (
                <div className="absolute top-0 right-0 z-50 bg-amber-500 text-white text-[10px] px-2 py-0.5 rounded-bl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                    {type} (Draft)
                </div>
            )}

            <Render config={puckConfig} data={template.content_rendered} />
        </div>
    );
};

export default DynamicTemplate;
