export const ReusableSectionBlockFields = {
  sectionSlug: {
    type: 'text',
    label: 'Section Slug',
  },
  title: {
    type: 'text',
    label: 'Fallback Label',
  },
};

export const ReusableSectionBlock = ({ sectionSlug, title, puck }) => {
  const label = sectionSlug || title || 'Reusable Section';

  return (
    <div className={`rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600 ${puck?.isEditing ? 'min-h-[64px]' : ''}`}>
      <div className="font-semibold text-slate-800">{title || 'Reusable Section'}</div>
      <div className="mt-1 text-xs text-slate-500">Slug: {label}</div>
      <div className="mt-2 text-xs text-slate-500">Rendered on the public site by resolving the tenant reusable section at request/build time.</div>
    </div>
  );
};
