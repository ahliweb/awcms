import { useState } from 'react';
import { Blocks, CopyPlus, GitMerge, RefreshCcw, Sparkles, Trash2, Unlink2, Wand2 } from 'lucide-react';
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
  const { sections, usagesBySection, detachEventsBySection, loading, saveSection, deleteSection, materializeSection, detachUsage, detachAllUsages, relinkDetachEvent, relinkAllDetachEvents, updateAllLinkedReferences } = useReusableSections();
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

          {sections.map((section) => {
            const usages = usagesBySection[section.id] || [];
            const detachEvents = detachEventsBySection[section.id] || [];

            return (
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
                  <div className="mt-3 rounded-xl border border-border/60 bg-muted/20 p-3">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Usage</p>
                    <p className="mt-1 text-xs text-foreground">{usages.length} reference(s)</p>
                    {usages.length > 0 ? (
                      <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                        {usages.slice(0, 4).map((usage) => (
                          <li key={usage.id} className="flex items-center justify-between gap-3">
                            <span>
                              {usage.source_type}: {usage.source_label || usage.source_id}
                              {usage.locale ? ` (${usage.locale})` : ''}
                            </span>
                            <Button size="sm" variant="ghost" className="h-7 rounded-lg px-2 text-[11px]" onClick={() => detachUsage(usage)}>
                              <Unlink2 className="mr-1 h-3.5 w-3.5" /> Detach
                            </Button>
                          </li>
                        ))}
                        {usages.length > 4 ? <li>+ {usages.length - 4} more</li> : null}
                      </ul>
                    ) : null}
                  </div>
                  <div className="mt-3 rounded-xl border border-border/60 bg-muted/20 p-3">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Detached Instances</p>
                    <p className="mt-1 text-xs text-foreground">{detachEvents.length} pending relink(s)</p>
                  {detachEvents.length > 0 ? (
                      <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                        {detachEvents.slice(0, 4).map((event) => (
                          <li key={event.id} className="flex items-center justify-between gap-3">
                            <span>
                              {event.source_type}: {event.source_label || event.source_id}
                              {event.locale ? ` (${event.locale})` : ''}
                            </span>
                            <Button size="sm" variant="ghost" className="h-7 rounded-lg px-2 text-[11px]" onClick={() => relinkDetachEvent(event)}>
                              <GitMerge className="mr-1 h-3.5 w-3.5" /> Relink
                            </Button>
                          </li>
                        ))}
                        {detachEvents.length > 4 ? <li>+ {detachEvents.length - 4} more</li> : null}
                      </ul>
                    ) : null}
                    {detachEvents.length > 0 ? (
                      <div className="mt-3">
                        <Button size="sm" variant="outline" className="rounded-lg" onClick={() => relinkAllDetachEvents({ sectionId: section.id })}>
                          <GitMerge className="mr-2 h-3.5 w-3.5" /> Relink All
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" className="rounded-xl" onClick={() => materializeSection({ sectionId: section.id })} disabled={!currentTenant?.id || (!canManagePlatform && !canManageTenantVariant)}>
                    <Wand2 className="mr-2 h-4 w-4" /> Materialize
                  </Button>
                  {usages.length > 0 ? (
                    <Button size="sm" variant="outline" className="rounded-xl" onClick={() => detachAllUsages({ sectionId: section.id })}>
                      <Unlink2 className="mr-2 h-4 w-4" /> Detach All
                    </Button>
                  ) : null}
                  {usages.length > 0 ? (
                    <Button size="sm" variant="outline" className="rounded-xl" onClick={() => updateAllLinkedReferences({ sectionId: section.id })}>
                      <RefreshCcw className="mr-2 h-4 w-4" /> Update Linked
                    </Button>
                  ) : null}
                  {(canManagePlatform || (canManageTenantVariant && section.owner_tenant_id === currentTenant?.id)) ? (
                    <Button size="sm" variant="ghost" className="rounded-xl text-destructive" onClick={() => deleteSection(section.id)}>
                      <Trash2 className="mr-2 h-4 w-4" /> Delete
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          )})}

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
