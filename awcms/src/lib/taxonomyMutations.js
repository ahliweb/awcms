import { supabase } from '@/lib/customSupabaseClient';

async function callTaxonomyMutation(rpcName, paramName, id) {
  const { error } = await supabase.rpc(rpcName, { [paramName]: id });

  if (error) {
    throw error;
  }

  return true;
}

export function softDeleteCategory(id) {
  return callTaxonomyMutation('soft_delete_category', 'p_category_id', id);
}

export function restoreCategory(id) {
  return callTaxonomyMutation('restore_category', 'p_category_id', id);
}

export function softDeleteTag(id) {
  return callTaxonomyMutation('soft_delete_tag', 'p_tag_id', id);
}

export function restoreTag(id) {
  return callTaxonomyMutation('restore_tag', 'p_tag_id', id);
}
