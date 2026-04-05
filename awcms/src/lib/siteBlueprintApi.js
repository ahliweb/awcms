import { supabase } from '@/lib/customSupabaseClient';

export const applySiteBlueprint = async ({ blueprintId, tenantId }) => {
  const { data, error } = await supabase.functions.invoke('site-blueprints', {
    body: {
      action: 'apply',
      blueprintId,
      tenantId,
    },
  });

  if (error) {
    throw error;
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  return data;
};
