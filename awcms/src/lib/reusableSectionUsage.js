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

const getReplacementBlocks = (content) => {
  if (Array.isArray(content?.content)) return content.content;
  if (Array.isArray(content?.root?.children)) return content.root.children;
  if (Array.isArray(content?.zones?.content)) return content.zones.content;
  return [];
};

const buildReusableSectionReferenceBlock = ({ slug, title }) => ({
  type: 'ReusableSection',
  props: {
    sectionSlug: slug,
    title: title || 'Reusable Section',
  },
});

const tokenizeUsagePath = (usagePath) => {
  return usagePath
    .replace(/^root\.?/, '')
    .split('.')
    .flatMap((segment) => {
      const tokens = [];
      const property = segment.match(/^([^[.]+)/)?.[1];
      if (property) tokens.push(property);
      const indexes = [...segment.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1]));
      return [...tokens, ...indexes];
    })
    .filter((token) => token !== '');
};

export const detachReusableSectionAtPath = (content, usagePath, replacementContent) => {
  const cloned = structuredClone(content);
  const tokens = tokenizeUsagePath(usagePath);

  if (tokens.length === 0) {
    return cloned;
  }

  let parent = cloned;
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index];
    if (parent == null) {
      return cloned;
    }
    parent = parent[token];
  }

  const lastToken = tokens[tokens.length - 1];
  const replacementBlocks = getReplacementBlocks(replacementContent);

  if (Array.isArray(parent) && typeof lastToken === 'number') {
    parent.splice(lastToken, 1, ...(replacementBlocks.length > 0 ? replacementBlocks : []));
    return cloned;
  }

  parent[lastToken] = replacementContent;
  return cloned;
};

export const relinkReusableSectionAtPath = (content, usagePath, referenceBlock) => {
  const cloned = structuredClone(content);
  const tokens = tokenizeUsagePath(usagePath);

  if (tokens.length === 0) {
    return cloned;
  }

  let parent = cloned;
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index];
    if (parent == null) {
      return cloned;
    }
    parent = parent[token];
  }

  const lastToken = tokens[tokens.length - 1];

  if (Array.isArray(parent) && typeof lastToken === 'number') {
    parent.splice(lastToken, 1, referenceBlock);
    return cloned;
  }

  parent[lastToken] = referenceBlock;
  return cloned;
};

const resolveReusableSectionContent = async ({ reusableSectionId }) => {
  const { data: section, error } = await supabase
    .from('reusable_sections')
    .select('id, section_mode, content, template_part_id')
    .eq('id', reusableSectionId)
    .is('deleted_at', null)
    .single();

  if (error) throw error;

  if (section.section_mode === 'template_part_reference' && section.template_part_id) {
    const { data: part, error: partError } = await supabase
      .from('template_parts')
      .select('content')
      .eq('id', section.template_part_id)
      .single();

    if (partError) throw partError;
    return part?.content || { content: [], root: { props: {} } };
  }

  return section.content || { content: [], root: { props: {} } };
};

const loadSourceContent = async ({ usage }) => {
  if (usage.source_type === 'template') {
    const { data, error } = await supabase.from('templates').select('data, tenant_id, name, slug').eq('id', usage.source_id).single();
    if (error) throw error;
    return {
      tenantId: data.tenant_id,
      content: data.data,
      save: async (nextContent) => supabase.from('templates').update({ data: nextContent, updated_at: new Date().toISOString() }).eq('id', usage.source_id),
      sourceLabel: data.name || data.slug || usage.source_label || 'Template',
      locale: usage.locale || null,
    };
  }

  if (usage.source_type === 'template_part') {
    const { data, error } = await supabase.from('template_parts').select('content, tenant_id, name, slug').eq('id', usage.source_id).single();
    if (error) throw error;
    return {
      tenantId: data.tenant_id,
      content: data.content,
      save: async (nextContent) => supabase.from('template_parts').update({ content: nextContent, updated_at: new Date().toISOString() }).eq('id', usage.source_id),
      sourceLabel: data.name || data.slug || usage.source_label || 'Template Part',
      locale: usage.locale || null,
    };
  }

  if (usage.source_type === 'page') {
    const { data, error } = await supabase.from('pages').select('content_draft, tenant_id, title, slug').eq('id', usage.source_id).single();
    if (error) throw error;
    return {
      tenantId: data.tenant_id,
      content: data.content_draft,
      save: async (nextContent) => supabase.from('pages').update({ content_draft: nextContent, updated_at: new Date().toISOString() }).eq('id', usage.source_id),
      sourceLabel: data.title || data.slug || usage.source_label || 'Page',
      locale: null,
    };
  }

  if (usage.source_type === 'content_translation') {
    const { data, error } = await supabase
      .from('content_translations')
      .select('content, tenant_id, title, slug, locale')
      .eq('content_id', usage.source_id)
      .eq('locale', usage.locale)
      .eq('content_type', 'page')
      .maybeSingle();

    if (error) throw error;

    const parsedContent = typeof data?.content === 'string' ? JSON.parse(data.content) : data?.content;

    return {
      tenantId: data?.tenant_id,
      content: parsedContent,
      save: async (nextContent) => supabase
        .from('content_translations')
        .update({ content: JSON.stringify(nextContent), updated_at: new Date().toISOString() })
        .eq('content_id', usage.source_id)
        .eq('locale', usage.locale)
        .eq('content_type', 'page'),
      sourceLabel: data?.title || data?.slug || usage.source_label || 'Content Translation',
      locale: data?.locale || usage.locale || null,
    };
  }

  throw new Error(`Unsupported usage source type: ${usage.source_type}`);
};

export const detachReusableSectionUsage = async ({ usage }) => {
  const replacementContent = await resolveReusableSectionContent({ reusableSectionId: usage.reusable_section_id });
  const source = await loadSourceContent({ usage });
  const nextContent = detachReusableSectionAtPath(source.content, usage.usage_path, replacementContent);

  const { error: saveError } = await source.save(nextContent);
  if (saveError) throw saveError;

  await syncReusableSectionUsages({
    tenantId: source.tenantId,
    sourceType: usage.source_type,
    sourceId: usage.source_id,
    sourceLabel: source.sourceLabel,
    locale: source.locale,
    content: nextContent,
  });

  const detachedSnapshot = Array.isArray(replacementContent?.content)
    ? replacementContent.content
    : replacementContent;

  const { error: eventError } = await supabase
    .from('reusable_section_detach_events')
    .insert({
      tenant_id: source.tenantId,
      reusable_section_id: usage.reusable_section_id,
      source_type: usage.source_type,
      source_id: usage.source_id,
      source_label: source.sourceLabel,
      locale: source.locale,
      usage_path: usage.usage_path,
      detached_snapshot: detachedSnapshot || {},
      status: 'pending',
      detached_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted_at: null,
    });

  if (eventError) throw eventError;

  return nextContent;
};

export const relinkReusableSectionDetachEvent = async ({ detachEvent }) => {
  const source = await loadSourceContent({ usage: detachEvent });

  const { data: section, error: sectionError } = await supabase
    .from('reusable_sections')
    .select('id, slug, name')
    .eq('id', detachEvent.reusable_section_id)
    .is('deleted_at', null)
    .single();

  if (sectionError) throw sectionError;

  const nextContent = relinkReusableSectionAtPath(
    source.content,
    detachEvent.usage_path,
    buildReusableSectionReferenceBlock({ slug: section.slug, title: section.name }),
  );

  const { error: saveError } = await source.save(nextContent);
  if (saveError) throw saveError;

  await syncReusableSectionUsages({
    tenantId: source.tenantId,
    sourceType: detachEvent.source_type,
    sourceId: detachEvent.source_id,
    sourceLabel: source.sourceLabel,
    locale: source.locale,
    content: nextContent,
  });

  const { error: updateError } = await supabase
    .from('reusable_section_detach_events')
    .update({
      status: 'relinked',
      relinked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', detachEvent.id);

  if (updateError) throw updateError;

  return nextContent;
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
