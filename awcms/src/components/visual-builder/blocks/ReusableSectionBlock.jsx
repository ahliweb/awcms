import { useEffect, useMemo, useState } from 'react';
import { ReusableSectionField } from '../fields/ReusableSectionField';
import { supabase } from '@/lib/customSupabaseClient';
import { useTenant } from '@/contexts/TenantContext';

export const ReusableSectionBlockFields = {
  sectionSlug: {
    type: 'custom',
    label: 'Section Slug',
    render: ReusableSectionField,
  },
  title: {
    type: 'text',
    label: 'Fallback Label',
  },
};

export const ReusableSectionBlock = ({ sectionSlug, title, puck }) => {
  const { currentTenant } = useTenant();
  const [previewState, setPreviewState] = useState({ loading: false, summary: null, error: null });
  const label = sectionSlug || title || 'Reusable Section';

  useEffect(() => {
    let isActive = true;

    const loadPreview = async () => {
      if (!sectionSlug) {
        if (isActive) {
          setPreviewState({ loading: false, summary: null, error: null });
        }
        return;
      }

      if (isActive) {
        setPreviewState((previous) => ({ ...previous, loading: true, error: null }));
      }

      try {
        let sectionQuery = supabase
          .from('reusable_sections')
          .select('section_mode, content, template_part_id, owner_tenant_id')
          .eq('slug', sectionSlug)
          .eq('status', 'active')
          .is('deleted_at', null);

        if (currentTenant?.id) {
          sectionQuery = sectionQuery.or(`owner_tenant_id.eq.${currentTenant.id},owner_tenant_id.is.null`);
        } else {
          sectionQuery = sectionQuery.is('owner_tenant_id', null);
        }

        const { data: section, error } = await sectionQuery.maybeSingle();

        if (error) throw error;

        let content = section?.content || null;
        if (section?.section_mode === 'template_part_reference' && section?.template_part_id) {
          let partQuery = supabase
            .from('template_parts')
            .select('content')
            .eq('id', section.template_part_id);

          if (currentTenant?.id) {
            partQuery = partQuery.or(`tenant_id.eq.${currentTenant.id},tenant_id.is.null`);
          } else {
            partQuery = partQuery.is('tenant_id', null);
          }

          const { data: part, error: partError } = await partQuery.maybeSingle();

          if (partError) throw partError;
          content = part?.content || null;
        }

        const blocks = content?.root?.children || content?.content || content?.zones?.content || [];
        const firstTypes = Array.isArray(blocks)
          ? blocks.map((block) => block?.type).filter((value) => typeof value === 'string').slice(0, 3)
          : [];

        if (isActive) {
          setPreviewState({
            loading: false,
            error: null,
            summary: {
              blockCount: Array.isArray(blocks) ? blocks.length : 0,
              firstTypes,
              source: section?.section_mode || 'visual',
            },
          });
        }
      } catch (error) {
        if (isActive) {
          setPreviewState({
            loading: false,
            summary: null,
            error: error?.message || 'Failed to load preview',
          });
        }
      }
    };

    loadPreview();

    return () => {
      isActive = false;
    };
  }, [sectionSlug, currentTenant?.id]);

  const previewLabel = useMemo(() => {
    if (previewState.loading) return 'Loading preview...';
    if (previewState.error) return previewState.error;
    if (!previewState.summary) return 'Rendered on the public site by resolving the tenant reusable section at request/build time.';

    const typesLabel = previewState.summary.firstTypes.length > 0
      ? previewState.summary.firstTypes.join(', ')
      : 'No blocks detected';

    return `${previewState.summary.blockCount} block(s) • ${typesLabel} • source ${previewState.summary.source}`;
  }, [previewState]);

  return (
    <div className={`rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600 ${puck?.isEditing ? 'min-h-[64px]' : ''}`}>
      <div className="font-semibold text-slate-800">{title || 'Reusable Section'}</div>
      <div className="mt-1 text-xs text-slate-500">Slug: {label}</div>
      <div className="mt-2 text-xs text-slate-500">{previewLabel}</div>
    </div>
  );
};
