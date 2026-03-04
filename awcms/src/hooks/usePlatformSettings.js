import { useState, useCallback, useEffect } from 'react';
import { udm } from '@/lib/data/UnifiedDataManager';
import { usePermissions } from '@/contexts/PermissionContext';

export function usePlatformSettings() {
    const { isPlatformAdmin } = usePermissions();
    const [settings, setSettings] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchSettings = useCallback(async () => {
        if (!isPlatformAdmin) {
            setSettings({});
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            const { data, error } = await udm
                .from('platform_settings')
                .select('*');

            if (error) throw error;

            // Convert array of settings to a key-value object
            const settingsMap = (data || []).reduce((acc, curr) => {
                acc[curr.key] = {
                    value: curr.value,
                    type: curr.type,
                    description: curr.description,
                    category: curr.category,
                    isOverridable: curr.is_overridable,
                    id: curr.id
                };
                return acc;
            }, {});

            setSettings(settingsMap);
            setError(null);
        } catch (err) {
            console.error('Error fetching platform settings:', err);
            setError(err);
        } finally {
            setLoading(false);
        }
    }, [isPlatformAdmin]);

    useEffect(() => {
        fetchSettings();
    }, [fetchSettings]);

    const updateSetting = async (key, value, additionalData = {}) => {
        if (!isPlatformAdmin) return { error: new Error('Unauthorized') };

        try {
            const type = additionalData.type || settings[key]?.type || 'string';
            const formattedValue = type === 'json' && typeof value === 'object'
                ? JSON.stringify(value)
                : String(value);

            const payload = {
                key,
                value: formattedValue,
                ...additionalData
            };

            const { data, error } = await udm
                .from('platform_settings')
                .upsert(payload, { onConflict: 'key' })
                .select()
                .single();

            if (error) throw error;

            // Optimistic update
            setSettings(prev => ({
                ...prev,
                [key]: {
                    ...(prev[key] || {}),
                    ...payload,
                    id: data?.id
                }
            }));

            return { data, error: null };
        } catch (err) {
            console.error(`Error updating platform setting ${key}:`, err);
            return { data: null, error: err };
        }
    };

    return {
        settings,
        loading,
        error,
        refresh: fetchSettings,
        updateSetting
    };
}
