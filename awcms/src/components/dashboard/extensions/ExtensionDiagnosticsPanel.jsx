import { AlertTriangle, CheckCircle2, Clock3, EyeOff, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import useExtensionDiagnostics from '@/hooks/useExtensionDiagnostics';

const formatDate = (value) => {
  if (!value) return 'Not available';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Not available' : parsed.toLocaleString();
};

function ExtensionDiagnosticsPanel({ extension, canViewDiagnostics }) {
  const diagnostics = useExtensionDiagnostics(extension, canViewDiagnostics);
  const tone = diagnostics.validationStatus === 'invalid'
    ? 'destructive'
    : diagnostics.validationStatus === 'warning'
      ? 'secondary'
      : 'default';

  return (
    <div className="mt-4 rounded-xl border border-border/60 bg-background/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            {diagnostics.validationStatus === 'invalid' ? <AlertTriangle className="h-4 w-4 text-destructive" /> : <ShieldCheck className="h-4 w-4 text-emerald-600" />}
            <h4 className="text-sm font-semibold text-foreground">Diagnostics</h4>
            <Badge variant={tone}>{diagnostics.validationStatus}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Runtime `{diagnostics.runtimeMode}` • Compatibility {diagnostics.compatibilityStatus}
          </p>
        </div>
        {!canViewDiagnostics ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/40 px-2 py-1 text-[10px] text-muted-foreground">
            <EyeOff className="h-3 w-3" /> Redacted
          </span>
        ) : null}
      </div>

      <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
        <div>Activation: <span className="font-medium text-foreground">{diagnostics.activationState}</span></div>
        <div>Desired: <span className="font-medium text-foreground">{diagnostics.desiredActivationState}</span></div>
        <div>Last validated: <span className="font-medium text-foreground">{formatDate(diagnostics.lastValidatedAt)}</span></div>
        <div>Last invalidated: <span className="font-medium text-foreground">{formatDate(diagnostics.lastInvalidatedAt)}</span></div>
        <div>Auto-deactivated: <span className="font-medium text-foreground">{formatDate(diagnostics.autoDeactivatedAt)}</span></div>
        <div>Auto-restored: <span className="font-medium text-foreground">{formatDate(diagnostics.autoRestoredAt)}</span></div>
        <div>Invalidated by version: <span className="font-medium text-foreground">{diagnostics.invalidatedByCatalogVersion || 'Not available'}</span></div>
        <div>Restored by version: <span className="font-medium text-foreground">{diagnostics.restoredByCatalogVersion || 'Not available'}</span></div>
      </div>

      <div className="mt-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Reason categories</p>
        <div className="flex flex-wrap gap-2">
          {diagnostics.reasonCategories.map((category) => (
            <span
              key={category.key}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] ${category.active ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-border/70 bg-muted/30 text-muted-foreground'}`}
            >
              {category.active ? <AlertTriangle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
              {category.key}
            </span>
          ))}
        </div>
      </div>

      {canViewDiagnostics ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-border/60 bg-card/60 p-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Invalid capabilities</p>
            {diagnostics.invalidCapabilities.length > 0 ? (
              <ul className="space-y-1 text-xs text-foreground">
                {diagnostics.invalidCapabilities.map((capability) => <li key={capability}>{capability}</li>)}
              </ul>
            ) : <p className="text-xs text-muted-foreground">None</p>}
          </div>
          <div className="rounded-lg border border-border/60 bg-card/60 p-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Missing artifacts</p>
            {diagnostics.missingArtifacts.length > 0 ? (
              <ul className="space-y-1 text-xs text-foreground">
                {diagnostics.missingArtifacts.map((artifact) => <li key={artifact}>{artifact}</li>)}
              </ul>
            ) : <p className="text-xs text-muted-foreground">None</p>}
          </div>
        </div>
      ) : (
        <div className="mt-4 inline-flex items-center gap-1 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <Clock3 className="h-3.5 w-3.5" /> Detailed diagnostics require `platform.extensions.diagnostics.read`.
        </div>
      )}
    </div>
  );
}

export default ExtensionDiagnosticsPanel;
