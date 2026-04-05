import { useState } from 'react';
import { Blocks, CopyPlus, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { usePermissions } from '@/contexts/PermissionContext';
import { useTenant } from '@/contexts/TenantContext';
import { useReusableSections } from '@/hooks/useReusableSections';

const DEFAULT_SECTION_CONTENT = {
  content: [],
  root: { props: { title: 'Reusable Section' } },
};

function ReusableSectionsManager() {
  const { currentTenant } = useTenant();
  const { hasPermission, isPlatformAdmin, isFullAccess } = usePermissions();
  const { sections, loading, saveSection, deleteSection, materializeSection } = useReusableSections();
  const [draft, setDraft] = useState({
    name: '',
    slug: '',
    description: '',
    section_mode: 'visual',
    status: 'draft',
    content: JSON.stringify(DEFAULT_SECTION_CONTENT, null, 2),
  });

  const canManagePlatform = isPlatformAdmin || isFullAccess || hasPermission('platform.template.manage');
  const canManageTenantVariant = hasPermission('tenant.setting.update');

  const handleSave = async () => {
    const parsedContent = JSON.parse(draft.content || '{}');
    await saveSection({
      name: draft.name,
      slug: draft.slug,
      description: draft.description,
      section_mode: draft.section_mode,
      status: draft.status,
      owner_tenant_id: canManagePlatform ? null : currentTenant?.id,
      content: parsedContent,
      metadata: { defaultPartType: 'widget_area' },
    });
    setDraft({
      name: '',
      slug: '',
      description: '',
      section_mode: 'visual',
      status: 'draft',
      content: JSON.stringify(DEFAULT_SECTION_CONTENT, null, 2),
    });
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border/60 bg-card/70 p-4 text-sm text-muted-foreground shadow-sm">
        Reusable sections are hybrid records that can store visual section content or reference a template part, then materialize into tenant template parts for use in the existing visual builder and widget-area flow.
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-4">
          {loading ? <div className="rounded-2xl border border-border/60 bg-card/60 p-8 text-center text-muted-foreground">Loading reusable sections...</div> : null}

          {sections.map((section) => (
            <div key={section.id} className="rounded-2xl border border-border/60 bg-card/75 p-4 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="font-semibold text-foreground">{section.name}</h4>
                    <span className="rounded-full border border-border/70 bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground">{section.owner_tenant_id ? 'Tenant section' : 'Platform section'}</span>
                    <span className="rounded-full border border-border/70 bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground">{section.section_mode}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Slug: {section.slug} • Status: {section.status}</p>
                  <p className="mt-2 text-sm text-muted-foreground">{section.description || 'No description provided.'}</p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" className="rounded-xl" onClick={() => materializeSection({ sectionId: section.id })} disabled={!currentTenant?.id || (!canManagePlatform && !canManageTenantVariant)}>
                    <Wand2 className="mr-2 h-4 w-4" /> Materialize
                  </Button>
                  {(canManagePlatform || (canManageTenantVariant && section.owner_tenant_id === currentTenant?.id)) ? (
                    <Button size="sm" variant="ghost" className="rounded-xl text-destructive" onClick={() => deleteSection(section.id)}>
                      <Trash2 className="mr-2 h-4 w-4" /> Delete
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          ))}

          {!loading && sections.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/70 bg-card/50 p-10 text-center text-muted-foreground">
              <Blocks className="mx-auto mb-3 h-10 w-10 opacity-50" />
              <p className="font-medium text-foreground">No reusable sections yet.</p>
            </div>
          ) : null}
        </div>

        <div className="rounded-2xl border border-border/60 bg-card/75 p-4 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <CopyPlus className="h-4 w-4 text-primary" />
            <h4 className="font-semibold text-foreground">Create reusable section</h4>
          </div>

          <div className="space-y-3">
            <Input value={draft.name} onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))} placeholder="Section name" />
            <Input value={draft.slug} onChange={(event) => setDraft((prev) => ({ ...prev, slug: event.target.value }))} placeholder="section-slug" />
            <Input value={draft.section_mode} onChange={(event) => setDraft((prev) => ({ ...prev, section_mode: event.target.value }))} placeholder="visual" />
            <Textarea value={draft.description} onChange={(event) => setDraft((prev) => ({ ...prev, description: event.target.value }))} placeholder="Describe the section" rows={3} />
            <Textarea value={draft.content} onChange={(event) => setDraft((prev) => ({ ...prev, content: event.target.value }))} placeholder={`{
  "content": [],
  "root": { "props": { "title": "Reusable Section" } }
}`} rows={12} className="font-mono text-xs" />
            <Button onClick={handleSave} disabled={!(canManagePlatform || canManageTenantVariant)} className="w-full rounded-xl">
              <Sparkles className="mr-2 h-4 w-4" /> Save reusable section
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ReusableSectionsManager;
