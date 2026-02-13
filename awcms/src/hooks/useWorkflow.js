import { useState, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { usePermissions } from '@/contexts/PermissionContext';
import { useToast } from '@/components/ui/use-toast';

export const WORKFLOW_STATES = {
    DRAFT: 'draft',
    REVIEWED: 'reviewed',
    APPROVED: 'approved',
    PUBLISHED: 'published'
};

/**
 * Hook for managing Workflow State Transitions
 * @returns {object} { updateState, canTransition, currentState }
 */
export function useWorkflow(initialState = 'draft', resourceType = 'posts', resourceId = null) {
    const { user } = useAuth();
    const { hasPermission } = usePermissions();
    const { toast } = useToast();
    const [currentState, setCurrentState] = useState(initialState);
    const [loading, setLoading] = useState(false);

    /**
     * Checks if the current user can transition to the target state
     * @param {string} targetState 
     * @returns {boolean}
     */
    const canTransition = useCallback((targetState) => {
        if (!user) return false;

        const permissionResource = resourceType === 'blog' ? 'blog' : resourceType;

        // Simple State Machine Logic:
        switch (targetState) {
            case WORKFLOW_STATES.DRAFT:
                return true; // Anyone can revert to draft if they have edit rights
            case WORKFLOW_STATES.REVIEWED:
                // Author can request review
                return hasPermission(`tenant.${permissionResource}.create`) || hasPermission(`tenant.${permissionResource}.update`);
            case WORKFLOW_STATES.APPROVED:
                // Editor/Admin only
                return hasPermission(`tenant.${permissionResource}.publish`);
            case WORKFLOW_STATES.PUBLISHED:
                // Editor/Admin only
                return hasPermission(`tenant.${permissionResource}.publish`);
            default:
                return false;
        }
    }, [user, hasPermission, resourceType]);

    /**
     * Updates the workflow state
     * @param {string} newState 
     * @param {string} comment - Optional comment for the log (future)
     */
    const updateState = async (newState, _comment = '') => {
        if (!resourceId) {
            console.error('Cannot update workflow: No Resource ID');
            return false;
        }

        if (!canTransition(newState)) {
            toast({ variant: "destructive", title: "Access Denied", description: "You cannot move to this state." });
            return false;
        }

        setLoading(true);
        try {
            const table = resourceType === 'page' ? 'pages' : (resourceType === 'blog' ? 'blogs' : 'posts');

            const payload = {
                workflow_state: newState,
                updated_at: new Date().toISOString()
            };

            // If publishing, update status column too for backward compatibility
            if (newState === WORKFLOW_STATES.PUBLISHED) {
                payload.status = 'published';
            } else if (newState === WORKFLOW_STATES.DRAFT) {
                payload.status = 'draft';
            }

            const { error } = await supabase
                .from(table)
                .update(payload)
                .eq('id', resourceId);

            if (error) throw error;

            setCurrentState(newState);
            toast({ title: "Workflow Updated", description: `State changed to ${newState}` });
            return true;
        } catch (err) {
            console.error('Workflow update failed:', err);
            toast({ variant: "destructive", title: "Update Failed", description: err.message });
            return false;
        } finally {
            setLoading(false);
        }
    };

    return {
        currentState,
        setCurrentState,
        updateState,
        canTransition,
        loading,
        WORKFLOW_STATES
    };
}
