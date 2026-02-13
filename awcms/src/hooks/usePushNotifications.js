/**
 * usePushNotifications Hook
 * Manage push notification campaigns
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { usePermissions } from '@/contexts/PermissionContext';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';

export function usePushNotifications() {
    const [notifications, setNotifications] = useState([]);
    const [loading, setLoading] = useState(true);
    const { tenantId } = usePermissions();
    const { user } = useAuth();
    const { toast } = useToast();

    // Fetch notifications
    const fetchNotifications = useCallback(async () => {
        if (!tenantId) return;

        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('push_notifications')
                .select(`
          *,
          created_by_user:users!push_notifications_created_by_fkey(full_name)
        `)
                .eq('tenant_id', tenantId)
                .is('deleted_at', null)
                .order('created_at', { ascending: false });

            if (error) throw error;
            setNotifications(data || []);
        } catch {
            toast({
                variant: 'destructive',
                title: 'Error',
                description: 'Failed to fetch notifications',
            });
        } finally {
            setLoading(false);
        }
    }, [tenantId, toast]);

    useEffect(() => {
        fetchNotifications();
    }, [fetchNotifications]);

    // Create notification
    const createNotification = async (data) => {
        try {
            const { data: newData, error } = await supabase
                .from('push_notifications')
                .insert({
                    ...data,
                    tenant_id: tenantId,
                    created_by: user?.id,
                    deleted_at: null,
                })
                .select()
                .single();

            if (error) throw error;

            setNotifications((prev) => [newData, ...prev]);
            toast({ title: 'Notification Created' });
            return newData;
        } catch (err) {
            toast({
                variant: 'destructive',
                title: 'Error',
                description: err.message,
            });
            throw err;
        }
    };

    // Send notification
    const sendNotification = async (id) => {
        try {
            const { error } = await supabase
                .from('push_notifications')
                .update({
                    status: 'sent',
                    sent_at: new Date().toISOString(),
                })
                .eq('id', id);

            if (error) throw error;

            setNotifications((prev) =>
                prev.map((n) =>
                    n.id === id
                        ? { ...n, status: 'sent', sent_at: new Date().toISOString() }
                        : n
                )
            );
            toast({ title: 'Notification Sent' });
        } catch (err) {
            toast({
                variant: 'destructive',
                title: 'Error',
                description: err.message,
            });
        }
    };

    // Delete notification
    const deleteNotification = async (id) => {
        try {
            const { error } = await supabase
                .from('push_notifications')
                .update({ deleted_at: new Date().toISOString() })
                .eq('id', id);

            if (error) throw error;

            setNotifications((prev) => prev.filter((n) => n.id !== id));
            toast({ title: 'Notification Moved to Trash' });
        } catch (err) {
            toast({
                variant: 'destructive',
                title: 'Error',
                description: err.message,
            });
        }
    };

    return {
        notifications,
        loading,
        fetchNotifications,
        createNotification,
        sendNotification,
        deleteNotification,
    };
}

export default usePushNotifications;
