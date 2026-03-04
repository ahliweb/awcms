import { useState, useEffect } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useTenant } from '@/contexts/TenantContext';

export function useEffectiveSetting(key) {
    const { tenantId } = useTenant();
    const [value, setValue] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        let isMounted = true;

        async function fetchEffectiveSetting() {
            if (!tenantId || !key) {
                if (isMounted) {
                    setValue(null);
                    setLoading(false);
                }
                return;
            }

            try {
                setLoading(true);
                // Call the RPC that handles the fallback logic: tenant setting -> platform default
                const { data, error } = await supabase
                    .rpc('get_effective_setting', { p_key: key, p_tenant_id: tenantId });

                if (error) throw error;

                if (isMounted) {
                    setValue(data);
                    setError(null);
                }
            } catch (err) {
                console.error(`Error fetching effective setting for ${key}:`, err);
                if (isMounted) {
                    setError(err);
                }
            } finally {
                if (isMounted) {
                    setLoading(false);
                }
            }
        }

        fetchEffectiveSetting();

        return () => {
            isMounted = false;
        };
    }, [key, tenantId]);

    return { value, loading, error };
}
