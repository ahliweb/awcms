import { supabase } from '@/lib/customSupabaseClient';

export const extractReusableSectionReferences = (content, path = 'root') => {
  const references = [];

  const visit = (node, currentPath) => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${currentPath}[${index}]`));
      return;
    }

    if (!node || typeof node !== 'object') {
      return;
    }

    if (node.type === 'ReusableSection' && typeof node.props?.sectionSlug === 'string' && node.props.sectionSlug.trim().length > 0) {
      references.push({
        slug: node.props.sectionSlug.trim(),
        usagePath: currentPath,
      });
    }

    Object.entries(node).forEach(([key, value]) => {
      if (key === 'sectionSlug') return;
      visit(value, `${currentPath}.${key}`);
    });
  };

  visit(content, path);
  return references;
};

export const syncReusableSectionUsages = async ({
  tenantId,
  sourceType,
  sourceId,
  sourceLabel,
  locale = null,
  content,
}) => {
  if (!tenantId || !sourceType || !sourceId) {
    return;
  }

  const references = extractReusableSectionReferences(content);

  const baseDelete = supabase
    .from('reusable_section_usages')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('source_type', sourceType)
    .eq('source_id', sourceId);

  const deleteQuery = locale ? baseDelete.eq('locale', locale) : baseDelete.is('locale', null);
  const { error: deleteError } = await deleteQuery;
  if (deleteError) throw deleteError;

  if (references.length === 0) {
    return;
  }

  const uniqueSlugs = [...new Set(references.map((reference) => reference.slug))];
  const { data: sectionRows, error: sectionError } = await supabase
    .from('reusable_sections')
    .select('id, slug, owner_tenant_id')
    .in('slug', uniqueSlugs)
    .eq('status', 'active')
    .is('deleted_at', null)
    .or(`owner_tenant_id.eq.${tenantId},owner_tenant_id.is.null`);

  if (sectionError) throw sectionError;

  const sectionMap = new Map();
  (sectionRows || []).forEach((row) => {
    const existing = sectionMap.get(row.slug);
    if (!existing || (row.owner_tenant_id && row.owner_tenant_id === tenantId)) {
      sectionMap.set(row.slug, row);
    }
  });

  const rows = references
    .map((reference) => {
      const section = sectionMap.get(reference.slug);
      if (!section) return null;
      return {
        tenant_id: tenantId,
        reusable_section_id: section.id,
        source_type: sourceType,
        source_id: sourceId,
        source_label: sourceLabel || null,
        locale,
        usage_path: reference.usagePath,
        updated_at: new Date().toISOString(),
        deleted_at: null,
      };
    })
    .filter(Boolean);

  if (rows.length === 0) {
    return;
  }

  const { error: insertError } = await supabase
    .from('reusable_section_usages')
    .insert(rows);

  if (insertError) throw insertError;
};
