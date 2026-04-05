import { useMemo, useState } from 'react';
import { Blocks, CheckCircle2, CopyPlus, Rocket, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { usePermissions } from '@/contexts/PermissionContext';
import { useTenant } from '@/contexts/TenantContext';
import { useSiteBlueprints } from '@/hooks/useSiteBlueprints';

const DEFAULT_BLUEPRINT_PAYLOAD = {
  settings: {},
  publicModules: [],
  assignments: [],
};

function SiteBlueprintsManager() {
  const { currentTenant } = useTenant();
  const { hasPermission, isPlatformAdmin, isFullAccess } = usePermissions();
  const { blueprints, activeBlueprintState, loading, saveBlueprint, deleteBlueprint, applyBlueprint } = useSiteBlueprints();
  const [draft, setDraft] = useState({
    name: '',
    slug: '',
    description: '',
    category: 'general',
    status: 'draft',
    blueprint_payload: JSON.stringify(DEFAULT_BLUEPRINT_PAYLOAD, null, 2),
  });

  const canManagePlatform = isPlatformAdmin || isFullAccess || hasPermission('platform.template.manage');
  const canManageTenantVariant = hasPermission('tenant.setting.update');

  const visibleBlueprints = useMemo(() => blueprints.filter((blueprint) => !blueprint.deleted_at), [blueprints]);

  const handleSave = async () => {
    const parsedPayload = JSON.parse(draft.blueprint_payload || '{}');
    await saveBlueprint({
      name: draft.name,
      slug: draft.slug,
      description: draft.description,
      category: draft.category,
      status: draft.status,
      owner_tenant_id: canManagePlatform ? null : currentTenant?.id,
      blueprint_payload: parsedPayload,
    });
    setDraft({
      name: '',
      slug: '',
      description: '',
      category: 'general',
      status: 'draft',
      blueprint_payload: JSON.stringify(DEFAULT_BLUEPRINT_PAYLOAD, null, 2),
    });
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border/60 bg-card/70 p-4 text-sm text-muted-foreground shadow-sm">
        Site blueprints package reusable tenant bootstrap payloads for template assignments, public module defaults, and site-scoped settings. Platform users can publish shared blueprints; tenant users can author tenant-scoped variants.
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-4">
          {loading ? <div className="rounded-2xl border border-border/60 bg-card/60 p-8 text-center text-muted-foreground">Loading blueprints...</div> : null}

          {visibleBlueprints.map((blueprint) => {
            const isActive = activeBlueprintState?.blueprint_id === blueprint.id;
            const isTenantVariant = Boolean(blueprint.owner_tenant_id);

            return (
              <div key={blueprint.id} className="rounded-2xl border border-border/60 bg-card/75 p-4 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold text-foreground">{blueprint.name}</h4>
                      {isActive ? <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-700"><CheckCircle2 className="h-3 w-3" /> Active</span> : null}
                      <span className="rounded-full border border-border/70 bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground">{isTenantVariant ? 'Tenant variant' : 'Platform blueprint'}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">Slug: {blueprint.slug} • Status: {blueprint.status}</p>
                    <p className="mt-2 text-sm text-muted-foreground">{blueprint.description || 'No description provided.'}</p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" className="rounded-xl" onClick={() => applyBlueprint({ blueprintId: blueprint.id })} disabled={!currentTenant?.id || (!canManagePlatform && !canManageTenantVariant)}>
                      <Rocket className="mr-2 h-4 w-4" /> Apply
                    </Button>
                    {(canManagePlatform || (canManageTenantVariant && blueprint.owner_tenant_id === currentTenant?.id)) ? (
                      <Button size="sm" variant="ghost" className="rounded-xl text-destructive" onClick={() => deleteBlueprint(blueprint.id)}>
                        <Trash2 className="mr-2 h-4 w-4" /> Delete
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}

          {!loading && visibleBlueprints.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/70 bg-card/50 p-10 text-center text-muted-foreground">
              <Blocks className="mx-auto mb-3 h-10 w-10 opacity-50" />
              <p className="font-medium text-foreground">No site blueprints yet.</p>
            </div>
          ) : null}
        </div>

        <div className="rounded-2xl border border-border/60 bg-card/75 p-4 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <CopyPlus className="h-4 w-4 text-primary" />
            <h4 className="font-semibold text-foreground">Create blueprint</h4>
          </div>

          <div className="space-y-3">
            <Input value={draft.name} onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))} placeholder="Blueprint name" />
            <Input value={draft.slug} onChange={(event) => setDraft((prev) => ({ ...prev, slug: event.target.value }))} placeholder="blueprint-slug" />
            <Input value={draft.category} onChange={(event) => setDraft((prev) => ({ ...prev, category: event.target.value }))} placeholder="general" />
            <Textarea value={draft.description} onChange={(event) => setDraft((prev) => ({ ...prev, description: event.target.value }))} placeholder="Describe the blueprint" rows={3} />
            <Textarea value={draft.blueprint_payload} onChange={(event) => setDraft((prev) => ({ ...prev, blueprint_payload: event.target.value }))} placeholder={`{
  "settings": {},
  "publicModules": [],
  "assignments": []
}`} rows={14} className="font-mono text-xs" />
            <Button onClick={handleSave} disabled={!(canManagePlatform || canManageTenantVariant)} className="w-full rounded-xl">
              <Save className="mr-2 h-4 w-4" /> Save blueprint
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SiteBlueprintsManager;
