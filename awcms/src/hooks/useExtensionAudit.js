/**
 * useExtensionAudit Hook
 * 
 * Provides functions to log and read extension audit events.
 * All logs are automatically created via database triggers,
 * but this hook allows manual logging for frontend actions.
 */

import { useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { usePermissions } from '@/contexts/PermissionContext';

/**
 * Log an extension action manually (for frontend events)
 * @param {Object} params - Log parameters
 * @param {string} params.extensionId - UUID of the extension
 * @param {string} params.extensionSlug - Slug of the extension
 * @param {string} params.action - Action type: install|uninstall|activate|deactivate|update|config_change|error
 * @param {Object} params.details - Additional details object
 */
export const logExtensionAction = async ({ extensionId, extensionSlug, action, details = {} }) => {
    try {
        // Get current tenant context
        const { data: { user } } = await supabase.auth.getUser();
        const { data: profile } = await supabase
            .from('profiles')
            .select('tenant_id')
            .eq('id', user?.id)
            .single();

        if (!profile?.tenant_id) {
            console.warn('[Extension Audit] No tenant context for logging');
            return null;
        }

        const { data, error } = await supabase
            .from('extension_logs')
            .insert({
                tenant_id: profile.tenant_id,
                extension_id: extensionId,
                extension_slug: extensionSlug,
                action,
                details,
                user_id: user?.id
            })
            .select()
            .single();

        if (error) throw error;
        return data;
    } catch (err) {
        console.error('[Extension Audit] Failed to log action:', err);
        return null;
    }
};

/**
 * Hook for extension audit operations
 */
export function useExtensionAudit() {
    const { hasPermission } = usePermissions();

    /**
     * Fetch extension logs with filtering
     */
    const fetchLogs = useCallback(async (options = {}) => {
        const { extensionId, extensionSlug, action, limit = 50, offset = 0 } = options;

        try {
            let query = supabase
                .from('extension_logs')
                .select('*, extension:extensions(name, slug), user:auth.users(email)')
                .order('created_at', { ascending: false })
                .range(offset, offset + limit - 1);

            if (extensionId) {
                query = query.eq('extension_id', extensionId);
            }
            if (extensionSlug) {
                query = query.eq('extension_slug', extensionSlug);
            }
            if (action) {
                query = query.eq('action', action);
            }

            const { data, error, count } = await query;
            if (error) throw error;

            return { logs: data || [], count };
        } catch (err) {
            console.error('[Extension Audit] Failed to fetch logs:', err);
            return { logs: [], count: 0 };
        }
    }, []);

    /**
     * Log an error from an extension
     */
    const logError = useCallback(async (extensionSlug, error) => {
        return logExtensionAction({
            extensionSlug,
            action: 'error',
            details: {
                message: error.message || String(error),
                stack: error.stack,
                timestamp: new Date().toISOString()
            }
        });
    }, []);

    /**
     * Check if user can view logs
     */
    const canViewLogs = hasPermission('tenant.audit.read') || hasPermission('platform.extensions.read');

    return {
        fetchLogs,
        logError,
        logExtensionAction,
        canViewLogs
    };
}

export default useExtensionAudit;
