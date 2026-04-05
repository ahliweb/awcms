import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useTenant } from '@/contexts/TenantContext';
import { useToast } from '@/components/ui/use-toast';
import { materializeReusableSection } from '@/lib/reusableSectionsApi';
import { detachReusableSectionUsage } from '@/lib/reusableSectionUsage';

export function useReusableSections() {
  const { currentTenant } = useTenant();
  const { toast } = useToast();
  const [sections, setSections] = useState([]);
  const [usagesBySection, setUsagesBySection] = useState({});
  const [loading, setLoading] = useState(true);

  const fetchSections = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data, error }, { data: usageRows, error: usageError }] = await Promise.all([
        supabase
          .from('reusable_sections')
          .select('*')
          .is('deleted_at', null)
          .order('updated_at', { ascending: false }),
        supabase
          .from('reusable_section_usages')
          .select('*')
          .is('deleted_at', null)
          .order('updated_at', { ascending: false }),
      ]);

      if (error) throw error;
      if (usageError) throw usageError;
      setSections(data || []);

      const groupedUsages = (usageRows || []).reduce((accumulator, usage) => {
        if (!accumulator[usage.reusable_section_id]) {
          accumulator[usage.reusable_section_id] = [];
        }
        accumulator[usage.reusable_section_id].push(usage);
        return accumulator;
      }, {});

      setUsagesBySection(groupedUsages);
    } catch (error) {
      toast({ title: 'Error', description: error.message || 'Failed to load reusable sections', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchSections();
  }, [fetchSections]);

  const saveSection = useCallback(async (section) => {
    const payload = {
      ...section,
      owner_tenant_id: section.owner_tenant_id ?? currentTenant?.id ?? null,
      updated_at: new Date().toISOString(),
      deleted_at: null,
    };

    const query = supabase.from('reusable_sections');
    const { error } = section.id
      ? await query.update(payload).eq('id', section.id)
      : await query.insert([{ ...payload, created_at: new Date().toISOString() }]);

    if (error) throw error;
    await fetchSections();
  }, [currentTenant?.id, fetchSections]);

  const deleteSection = useCallback(async (sectionId) => {
    const { error } = await supabase
      .from('reusable_sections')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', sectionId);
    if (error) throw error;
    await fetchSections();
  }, [fetchSections]);

  const materializeSection = useCallback(async ({ sectionId, tenantId = currentTenant?.id, partType = 'widget_area' }) => {
    const result = await materializeReusableSection({ sectionId, tenantId, partType });
    toast({ title: 'Materialized', description: 'Reusable section turned into a template part.' });
    return result;
  }, [currentTenant?.id, toast]);

  const detachUsage = useCallback(async (usage) => {
    await detachReusableSectionUsage({ usage });
    toast({ title: 'Detached', description: 'Reusable section usage was converted into inline content.' });
    await fetchSections();
  }, [fetchSections, toast]);

  const detachAllUsages = useCallback(async ({ sectionId }) => {
    const usages = usagesBySection[sectionId] || [];
    for (const usage of usages) {
      // Sequential updates keep source saves deterministic when multiple usages belong to the same record.
      // This avoids stale-content races between separate detach operations.
      // eslint-disable-next-line no-await-in-loop
      await detachReusableSectionUsage({ usage });
    }
    toast({ title: 'Detached All', description: 'All tracked usages were converted into inline content.' });
    await fetchSections();
  }, [fetchSections, toast, usagesBySection]);

  return {
    sections,
    usagesBySection,
    loading,
    fetchSections,
    saveSection,
    deleteSection,
    materializeSection,
    detachUsage,
    detachAllUsages,
  };
}
