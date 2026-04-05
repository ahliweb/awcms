import { useState } from 'react';
import { Blocks, CheckCircle2, CopyPlus, GitCompare, GitMerge, History, RefreshCcw, ShieldAlert, Sparkles, Trash2, Unlink2, Wand2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { usePermissions } from '@/contexts/PermissionContext';
import { useTenant } from '@/contexts/TenantContext';
import { useReusableSections } from '@/hooks/useReusableSections';
import { compareReusableSectionRevision, compareReusableSectionRevisions } from '@/lib/reusableSectionDiff';

const DEFAULT_SECTION_CONTENT = {
  content: [],
  root: { props: { title: 'Reusable Section' } },
};

function ReusableSectionsManager() {
  const { currentTenant } = useTenant();
  const { hasPermission, isPlatformAdmin, isFullAccess } = usePermissions();
  const { sections, usagesBySection, detachEventsBySection, revisionsBySection, actionRequestsBySection, loading, saveSection, deleteSection, materializeSection, detachUsage, detachAllUsages, relinkDetachEvent, relinkAllDetachEvents, updateAllLinkedReferences, restoreRevision, submitActionRequest, approveActionRequest, rejectActionRequest } = useReusableSections();
  const [draft, setDraft] = useState({
    name: '',
    slug: '',
    description: '',
    section_mode: 'visual',
    status: 'draft',
    content: JSON.stringify(DEFAULT_SECTION_CONTENT, null, 2),
  });
  const [compareSelection, setCompareSelection] = useState(null);
  const [restoreConfirmation, setRestoreConfirmation] = useState(null);
  const [bulkActionConfirmation, setBulkActionConfirmation] = useState(null);

  const canManagePlatform = isPlatformAdmin || isFullAccess || hasPermission('platform.template.manage');
  const canManageTenantVariant = hasPermission('tenant.setting.update');
  const canApproveBulkActions = isPlatformAdmin || isFullAccess || hasPermission('platform.approvals.read') || hasPermission('platform.template.manage');

  const confirmBulkAction = () => {
    if (!bulkActionConfirmation) return;

    if (bulkActionConfirmation.action === 'detachAll') {
      detachAllUsages({ sectionId: bulkActionConfirmation.sectionId });
    }

    if (bulkActionConfirmation.action === 'relinkAll') {
      relinkAllDetachEvents({ sectionId: bulkActionConfirmation.sectionId });
    }

    if (bulkActionConfirmation.action === 'updateLinked') {
      updateAllLinkedReferences({ sectionId: bulkActionConfirmation.sectionId });
    }

    setBulkActionConfirmation(null);
  };

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
            const revisions = revisionsBySection[section.id] || [];
            const actionRequests = actionRequestsBySection[section.id] || [];
            const activeCompareRevision = compareSelection?.sectionId === section.id
              ? revisions.find((revision) => revision.id === compareSelection.revisionId) || null
              : null;
            const baseCompareRevision = compareSelection?.sectionId === section.id && compareSelection?.baseRevisionId
              ? revisions.find((revision) => revision.id === compareSelection.baseRevisionId) || null
              : null;
            const comparison = activeCompareRevision
              ? (baseCompareRevision
                  ? compareReusableSectionRevisions(baseCompareRevision.snapshot, activeCompareRevision.snapshot)
                  : compareReusableSectionRevision(section, activeCompareRevision.snapshot))
              : null;

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
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Bulk Action Requests</p>
                    <p className="mt-1 text-xs text-foreground">{actionRequests.filter((request) => request.status === 'pending').length} pending request(s)</p>
                    {actionRequests.length > 0 ? (
                      <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                        {actionRequests.slice(0, 4).map((request) => (
                          <li key={request.id} className="flex items-center justify-between gap-3">
                            <span>{request.action_type} • {request.status}</span>
                            {request.status === 'pending' && canApproveBulkActions ? (
                              <span className="flex items-center gap-1">
                                <Button size="sm" variant="ghost" className="h-7 rounded-lg px-2 text-[11px]" onClick={() => approveActionRequest(request)}>
                                  <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Approve
                                </Button>
                                <Button size="sm" variant="ghost" className="h-7 rounded-lg px-2 text-[11px]" onClick={() => rejectActionRequest(request)}>
                                  <XCircle className="mr-1 h-3.5 w-3.5" /> Reject
                                </Button>
                              </span>
                            ) : null}
                          </li>
                        ))}
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
                        {canApproveBulkActions ? (
                          <Button size="sm" variant="outline" className="rounded-lg" onClick={() => setBulkActionConfirmation({ action: 'relinkAll', sectionId: section.id, sectionName: section.name, count: detachEvents.length })}>
                            <GitMerge className="mr-2 h-3.5 w-3.5" /> Relink All
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" className="rounded-lg" onClick={() => submitActionRequest({ sectionId: section.id, actionType: 'relink_all', count: detachEvents.length })}>
                            <ShieldAlert className="mr-2 h-3.5 w-3.5" /> Request Relink All
                          </Button>
                        )}
                      </div>
                    ) : null}
                  </div>
                  <div className="mt-3 rounded-xl border border-border/60 bg-muted/20 p-3">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Revisions</p>
                    <p className="mt-1 text-xs text-foreground">{revisions.length} revision(s)</p>
                    {revisions.length > 0 ? (
                      <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                        {revisions.slice(0, 4).map((revision) => (
                          <li key={revision.id} className="flex items-center justify-between gap-3">
                            <span>
                              Revision {revision.revision_number} • {new Date(revision.created_at).toLocaleString()}
                            </span>
                            <span className="flex items-center gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 rounded-lg px-2 text-[11px]"
                                onClick={() => setCompareSelection((current) => {
                                  if (current?.sectionId !== section.id || !current) {
                                    return { sectionId: section.id, revisionId: revision.id, baseRevisionId: null };
                                  }

                                  if (current.revisionId === revision.id && !current.baseRevisionId) {
                                    return null;
                                  }

                                  if (!current.baseRevisionId && current.revisionId !== revision.id) {
                                    return { sectionId: section.id, revisionId: revision.id, baseRevisionId: current.revisionId };
                                  }

                                  if (current.baseRevisionId === revision.id) {
                                    return { sectionId: section.id, revisionId: current.revisionId, baseRevisionId: null };
                                  }

                                  return { sectionId: section.id, revisionId: revision.id, baseRevisionId: current.baseRevisionId };
                                })}
                              >
                                <GitCompare className="mr-1 h-3.5 w-3.5" /> Compare
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7 rounded-lg px-2 text-[11px]" onClick={() => setRestoreConfirmation({ sectionId: section.id, revisionId: revision.id, revisionNumber: revision.revision_number, createdAt: revision.created_at, sectionName: section.name })}>
                                <History className="mr-1 h-3.5 w-3.5" /> Restore
                              </Button>
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  {comparison ? (
                    <div className="mt-3 rounded-xl border border-border/60 bg-muted/20 p-3">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        {baseCompareRevision
                          ? `Compare revision ${baseCompareRevision?.revision_number} to revision ${activeCompareRevision?.revision_number}`
                          : `Compare current state with revision ${activeCompareRevision?.revision_number}`}
                      </p>
                      <p className="mt-1 text-xs text-foreground">
                        {comparison.hasChanges ? `${comparison.changedFields.length} changed field(s)` : 'No differences detected'}
                      </p>
                      {comparison.changedFields.length > 0 ? (
                        <div className="mt-3 space-y-2">
                          {comparison.changedFields.slice(0, 4).map((field) => (
                            <div key={field.key} className="rounded-lg border border-border/60 bg-background/70 p-2">
                              <p className="text-[11px] font-medium text-foreground">{field.label}</p>
                              <div className="mt-1 grid gap-2 md:grid-cols-2">
                                <div>
                                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Current</p>
                                  <pre className="mt-1 whitespace-pre-wrap break-words rounded bg-muted/40 p-2 text-[10px] text-foreground">{field.currentValue}</pre>
                                </div>
                                <div>
                                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Revision</p>
                                  <pre className="mt-1 whitespace-pre-wrap break-words rounded bg-muted/40 p-2 text-[10px] text-foreground">{field.revisionValue}</pre>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" className="rounded-xl" onClick={() => materializeSection({ sectionId: section.id })} disabled={!currentTenant?.id || (!canManagePlatform && !canManageTenantVariant)}>
                    <Wand2 className="mr-2 h-4 w-4" /> Materialize
                  </Button>
                  {usages.length > 0 ? (
                    canApproveBulkActions ? (
                      <Button size="sm" variant="outline" className="rounded-xl" onClick={() => setBulkActionConfirmation({ action: 'detachAll', sectionId: section.id, sectionName: section.name, count: usages.length })}>
                        <Unlink2 className="mr-2 h-4 w-4" /> Detach All
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" className="rounded-xl" onClick={() => submitActionRequest({ sectionId: section.id, actionType: 'detach_all', count: usages.length })}>
                        <ShieldAlert className="mr-2 h-4 w-4" /> Request Detach All
                      </Button>
                    )
                  ) : null}
                  {usages.length > 0 ? (
                    canApproveBulkActions ? (
                      <Button size="sm" variant="outline" className="rounded-xl" onClick={() => setBulkActionConfirmation({ action: 'updateLinked', sectionId: section.id, sectionName: section.name, count: usages.length })}>
                        <RefreshCcw className="mr-2 h-4 w-4" /> Update Linked
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" className="rounded-xl" onClick={() => submitActionRequest({ sectionId: section.id, actionType: 'update_linked', count: usages.length })}>
                        <ShieldAlert className="mr-2 h-4 w-4" /> Request Update Linked
                      </Button>
                    )
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

      <AlertDialog open={Boolean(restoreConfirmation)} onOpenChange={(open) => !open && setRestoreConfirmation(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore reusable section revision?</AlertDialogTitle>
            <AlertDialogDescription>
              {restoreConfirmation ? (
                <>
                  This will replace the current live state of <strong>{restoreConfirmation.sectionName}</strong> with revision{' '}
                  <strong>{restoreConfirmation.revisionNumber}</strong> from{' '}
                  <strong>{new Date(restoreConfirmation.createdAt).toLocaleString()}</strong>.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (restoreConfirmation) {
                  restoreRevision({ sectionId: restoreConfirmation.sectionId, revisionId: restoreConfirmation.revisionId });
                }
                setRestoreConfirmation(null);
              }}
            >
              Restore Revision
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(bulkActionConfirmation)} onOpenChange={(open) => !open && setBulkActionConfirmation(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {bulkActionConfirmation?.action === 'detachAll' ? 'Detach all linked usages?' : null}
              {bulkActionConfirmation?.action === 'relinkAll' ? 'Relink all detached instances?' : null}
              {bulkActionConfirmation?.action === 'updateLinked' ? 'Update all linked references?' : null}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {bulkActionConfirmation ? (
                <>
                  This will run the <strong>{bulkActionConfirmation.action}</strong> workflow for <strong>{bulkActionConfirmation.sectionName}</strong>
                  {typeof bulkActionConfirmation.count === 'number' ? <> across <strong>{bulkActionConfirmation.count}</strong> tracked item(s)</> : null}.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmBulkAction}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default ReusableSectionsManager;
