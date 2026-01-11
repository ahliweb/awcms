/**
 * useMobileUsers Hook
 * Fetch and manage mobile app users
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { usePermissions } from '@/contexts/PermissionContext';
import { useToast } from '@/components/ui/use-toast';

export function useMobileUsers() {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({ total: 0, ios: 0, android: 0, active: 0 });
    const { tenantId } = usePermissions();
    const { toast } = useToast();

    // Fetch mobile users
    const fetchUsers = useCallback(async () => {
        if (!tenantId) return;

        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('mobile_users')
                .select(`
          *,
          user:users(id, full_name, email, avatar_url)
        `)
                .eq('tenant_id', tenantId)
                .is('deleted_at', null)
                .order('last_active', { ascending: false });

            if (error) throw error;

            setUsers(data || []);

            // Calculate stats
            const total = data?.length || 0;
            const ios = data?.filter((u) => u.device_type === 'ios').length || 0;
            const android = data?.filter((u) => u.device_type === 'android').length || 0;
            const now = new Date();
            const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            const active = data?.filter((u) => new Date(u.last_active) > weekAgo).length || 0;

            setStats({ total, ios, android, active });
        } catch (err) {
            toast({
                variant: 'destructive',
                title: 'Error',
                description: 'Failed to fetch mobile users',
            });
        } finally {
            setLoading(false);
        }
    }, [tenantId, toast]);

    useEffect(() => {
        fetchUsers();
    }, [fetchUsers]);

    // Delete user registration
    const deleteUser = async (id) => {
        try {
            const { error } = await supabase
                .from('mobile_users')
                .update({ deleted_at: new Date().toISOString() })
                .eq('id', id);

            if (error) throw error;

            setUsers((prev) => prev.filter((u) => u.id !== id));
            toast({ title: 'User Removed' });
        } catch (err) {
            toast({
                variant: 'destructive',
                title: 'Error',
                description: err.message,
            });
        }
    };

    return {
        users,
        loading,
        stats,
        fetchUsers,
        deleteUser,
    };
}

export default useMobileUsers;
