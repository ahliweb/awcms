/**
 * useDevices Hook
 * Fetch and manage ESP32 IoT devices
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { usePermissions } from '@/contexts/PermissionContext';
import { useToast } from '@/components/ui/use-toast';

export function useDevices() {
    const [devices, setDevices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const { tenantId } = usePermissions();
    const { toast } = useToast();

    // Fetch all devices
    const fetchDevices = useCallback(async () => {
        if (!tenantId) return;

        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('devices')
                .select('*')
                .eq('tenant_id', tenantId)
                .is('deleted_at', null)
                .order('created_at', { ascending: false });

            if (error) throw error;
            setDevices(data || []);
        } catch (err) {
            setError(err.message);
            toast({
                variant: 'destructive',
                title: 'Error',
                description: 'Failed to fetch devices',
            });
        } finally {
            setLoading(false);
        }
    }, [tenantId, toast]);

    // Subscribe to realtime updates
    useEffect(() => {
        if (!tenantId) return;

        fetchDevices();

        // Realtime subscription
        const channel = supabase
            .channel('devices-changes')
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'devices',
                    filter: `tenant_id=eq.${tenantId}`,
                },
                (payload) => {
                    if (payload.eventType === 'INSERT') {
                        setDevices((prev) => [payload.new, ...prev]);
                    } else if (payload.eventType === 'UPDATE') {
                        setDevices((prev) =>
                            prev.map((d) => (d.id === payload.new.id ? payload.new : d))
                        );
                    } else if (payload.eventType === 'DELETE') {
                        setDevices((prev) => prev.filter((d) => d.id !== payload.old.id));
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [tenantId, fetchDevices]);

    // Register a new device
    const registerDevice = async (deviceData) => {
        try {
            const { data, error } = await supabase
                .from('devices')
                .insert({
                    ...deviceData,
                    tenant_id: tenantId,
                })
                .select()
                .single();

            if (error) throw error;

            toast({ title: 'Device Registered', description: data.device_name });
            return data;
        } catch (err) {
            toast({
                variant: 'destructive',
                title: 'Error',
                description: err.message,
            });
            throw err;
        }
    };

    // Update device
    const updateDevice = async (id, updates) => {
        try {
            const { data, error } = await supabase
                .from('devices')
                .update(updates)
                .eq('id', id)
                .select()
                .single();

            if (error) throw error;

            toast({ title: 'Device Updated' });
            return data;
        } catch (err) {
            toast({
                variant: 'destructive',
                title: 'Error',
                description: err.message,
            });
            throw err;
        }
    };

    // Soft delete device
    const deleteDevice = async (id) => {
        try {
            const { error } = await supabase
                .from('devices')
                .update({ deleted_at: new Date().toISOString() })
                .eq('id', id);

            if (error) throw error;

            setDevices((prev) => prev.filter((d) => d.id !== id));
            toast({ title: 'Device Deleted' });
        } catch (err) {
            toast({
                variant: 'destructive',
                title: 'Error',
                description: err.message,
            });
            throw err;
        }
    };

    return {
        devices,
        loading,
        error,
        fetchDevices,
        registerDevice,
        updateDevice,
        deleteDevice,
        onlineCount: devices.filter((d) => d.is_online).length,
        totalCount: devices.length,
    };
}
