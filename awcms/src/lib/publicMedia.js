import { supabase } from '@/lib/customSupabaseClient';
import { buildMediaPublicUrl } from '@/lib/media';

export const PUBLIC_MEDIA_SELECT = `
  id,
  tenant_id,
  title,
  description,
  alt_text,
  slug,
  mime_type,
  media_kind,
  storage_key,
  created_at,
  category_id,
  category:categories(id, name, slug, type)
`;

const applyPublicMediaBaseFilters = (query, mediaKind, tenantId) => {
  let scopedQuery = query
    .eq('status', 'uploaded')
    .eq('access_control', 'public')
    .eq('media_kind', mediaKind)
    .is('deleted_at', null);

  if (tenantId) {
    scopedQuery = scopedQuery.eq('tenant_id', tenantId);
  }

  return scopedQuery;
};

export const normalizePublicMediaItem = (item) => {
  if (!item) return null;

  return {
    ...item,
    title: item.title || item.alt_text || item.slug || item.id,
    imageUrl: buildMediaPublicUrl(item.storage_key),
    videoUrl: buildMediaPublicUrl(item.storage_key),
  };
};

export const fetchPublicMediaItems = async ({ mediaKind, tenantId, limit } = {}) => {
  let query = supabase
    .from('media_objects')
    .select(PUBLIC_MEDIA_SELECT)
    .order('created_at', { ascending: false });

  query = applyPublicMediaBaseFilters(query, mediaKind, tenantId);

  if (limit) {
    query = query.limit(limit);
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data || []).map(normalizePublicMediaItem);
};

export const fetchPublicMediaBySlug = async ({ mediaKind, slug, tenantId }) => {
  let query = supabase
    .from('media_objects')
    .select(PUBLIC_MEDIA_SELECT)
    .eq('slug', slug)
    .maybeSingle();

  query = applyPublicMediaBaseFilters(query, mediaKind, tenantId);

  const { data, error } = await query;
  if (error) throw error;

  return normalizePublicMediaItem(data);
};

export const fetchRelatedPublicMedia = async ({ mediaKind, currentId, categoryId, tenantId, limit = 3 }) => {
  let query = supabase
    .from('media_objects')
    .select(PUBLIC_MEDIA_SELECT)
    .neq('id', currentId)
    .limit(limit)
    .order('created_at', { ascending: false });

  query = applyPublicMediaBaseFilters(query, mediaKind, tenantId);

  if (categoryId) {
    query = query.eq('category_id', categoryId);
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data || []).map(normalizePublicMediaItem);
};
