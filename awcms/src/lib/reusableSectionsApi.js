import { supabase } from '@/lib/customSupabaseClient';

export const materializeReusableSection = async ({ sectionId, tenantId, partType = 'widget_area' }) => {
  const { data, error } = await supabase.functions.invoke('reusable-sections', {
    body: {
      action: 'materialize',
      sectionId,
      tenantId,
      partType,
    },
  });

  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
};
