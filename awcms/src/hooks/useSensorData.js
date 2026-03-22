/**
 * useSensorData Hook
 * Realtime sensor data from ESP32 devices
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { usePermissions } from '@/contexts/PermissionContext';

export function useSensorData(deviceId, options = {}) {
    const { limit = 50, realtime = true } = options;
    const [readings, setReadings] = useState([]);
    const [loading, setLoading] = useState(true);
    const [latestReading, setLatestReading] = useState(null);
    const { tenantId } = usePermissions();

    // Fetch sensor readings
    const fetchReadings = useCallback(async () => {
        if (!tenantId || !deviceId) return;

        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('sensor_readings')
                .select('*')
                .eq('tenant_id', tenantId)
                .eq('device_id', deviceId)
                .order('created_at', { ascending: false })
                .limit(limit);

            if (error) throw error;

            const sortedData = (data || []).reverse();
            setReadings(sortedData);
            setLatestReading(data?.[0] || null);
        } catch (err) {
            console.error('Failed to fetch sensor readings:', err);
        } finally {
            setLoading(false);
        }
    }, [tenantId, deviceId, limit]);

    // Realtime subscription
    useEffect(() => {
        if (!tenantId || !deviceId) return;

        fetchReadings();

        if (!realtime) return;

        const channel = supabase
            .channel(`sensor-${deviceId}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'sensor_readings',
                    filter: `device_id=eq.${deviceId}`,
                },
                (payload) => {
                    setReadings((prev) => {
                        const updated = [...prev, payload.new];
                        // Keep only last N readings
                        if (updated.length > limit) {
                            return updated.slice(-limit);
                        }
                        return updated;
                    });
                    setLatestReading(payload.new);
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [tenantId, deviceId, limit, realtime, fetchReadings]);

    // Get chart data format
    const chartData = readings.map((r) => ({
        time: new Date(r.created_at).toLocaleTimeString(),
        gas_ppm: r.gas_ppm || 0,
        temperature: r.temperature || 0,
        humidity: r.humidity || 0,
    }));

    return {
        readings,
        loading,
        latestReading,
        chartData,
        fetchReadings,
    };
}
