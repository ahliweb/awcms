import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useTenant } from '@/contexts/TenantContext';
import { useToast } from '@/components/ui/use-toast';
import { applySiteBlueprint } from '@/lib/siteBlueprintApi';

export function useSiteBlueprints() {
  const { currentTenant } = useTenant();
  const { toast } = useToast();
  const [blueprints, setBlueprints] = useState([]);
  const [activeBlueprintState, setActiveBlueprintState] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchBlueprints = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: blueprintRows, error: blueprintError }, { data: stateRow, error: stateError }] = await Promise.all([
        supabase
          .from('site_blueprints')
          .select('*')
          .is('deleted_at', null)
          .order('updated_at', { ascending: false }),
        currentTenant?.id
          ? supabase
              .from('tenant_site_blueprint_state')
              .select('*, blueprint:site_blueprints(*)')
              .eq('tenant_id', currentTenant.id)
              .is('deleted_at', null)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);

      if (blueprintError) throw blueprintError;
      if (stateError) throw stateError;

      setBlueprints(blueprintRows || []);
      setActiveBlueprintState(stateRow || null);
    } catch (error) {
      toast({ title: 'Error', description: error.message || 'Failed to load site blueprints', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [currentTenant?.id, toast]);

  useEffect(() => {
    fetchBlueprints();
  }, [fetchBlueprints]);

  const saveBlueprint = useCallback(async (blueprint) => {
    const payload = {
      ...blueprint,
      owner_tenant_id: blueprint.owner_tenant_id ?? currentTenant?.id ?? null,
      updated_at: new Date().toISOString(),
      deleted_at: null,
    };

    const query = supabase.from('site_blueprints');
    const { error } = blueprint.id
      ? await query.update(payload).eq('id', blueprint.id)
      : await query.insert([{ ...payload, created_at: new Date().toISOString() }]);

    if (error) throw error;
    await fetchBlueprints();
  }, [currentTenant?.id, fetchBlueprints]);

  const deleteBlueprint = useCallback(async (blueprintId) => {
    const { error } = await supabase
      .from('site_blueprints')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', blueprintId);

    if (error) throw error;
    await fetchBlueprints();
  }, [fetchBlueprints]);

  const applyBlueprint = useCallback(async ({ blueprintId, tenantId = currentTenant?.id }) => {
    const result = await applySiteBlueprint({ blueprintId, tenantId });
    toast({ title: 'Applied', description: 'Site blueprint applied successfully.' });
    await fetchBlueprints();
    return result;
  }, [currentTenant?.id, fetchBlueprints, toast]);

  return {
    blueprints,
    activeBlueprintState,
    loading,
    fetchBlueprints,
    saveBlueprint,
    deleteBlueprint,
    applyBlueprint,
  };
}
