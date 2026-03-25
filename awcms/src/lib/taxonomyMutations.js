import { supabase } from '@/lib/customSupabaseClient';

async function callTaxonomyMutation(rpcName, paramName, id) {
  const { error } = await supabase.rpc(rpcName, { [paramName]: id });

  if (error) {
    throw error;
  }

  return true;
}

function normalizeTagPayload(payload) {
  const normalizedName = payload.name?.trim();
  const normalizedSlug = payload.slug?.trim();
  const normalizedDescription = payload.description?.trim();
  const normalizedIcon = payload.icon?.trim();

  return {
    name: normalizedName,
    slug: normalizedSlug,
    color: payload.color,
    description: normalizedDescription || null,
    icon: normalizedIcon || null,
    is_active: payload.is_active,
    updated_at: new Date().toISOString(),
  };
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

export async function createTag({ tenantId, ...payload }) {
  if (!tenantId) {
    throw new Error('An active tenant is required to create a tag.');
  }

  const { data, error } = await supabase
    .from('tags')
    .insert([
      {
        ...normalizeTagPayload(payload),
        tenant_id: tenantId,
      },
    ])
    .select('id')
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function updateTag(id, payload, options = {}) {
  const { tenantId } = options;

  let query = supabase
    .from('tags')
    .update(normalizeTagPayload(payload))
    .eq('id', id);

  if (tenantId) {
    query = query.eq('tenant_id', tenantId);
  }

  const { data, error } = await query.select('id').maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error('Tag not found in the current tenant scope.');
  }

  return data;
}
