import { RefreshCw, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';

function LoadingState() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-32 w-full rounded-2xl" />
      <Skeleton className="h-64 w-full rounded-2xl" />
    </div>
  );
}

export default function SettingsPageShell({
  requiredPermission,
  title,
  description,
  icon,
  breadcrumbs,
  loading = false,
  onReload,
  onSave,
  saving = false,
  hasChanges = false,
  saveLabel = 'Save Changes',
  children,
  actions = null,
}) {
  const headerActions = (
    <div className="flex flex-wrap items-center gap-2">
      {onReload ? (
        <Button type="button" variant="outline" onClick={onReload} disabled={loading || saving}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      ) : null}

      {onSave ? (
        <Button type="button" onClick={onSave} disabled={saving || !hasChanges}>
          {saving ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          {saving ? 'Saving...' : saveLabel}
        </Button>
      ) : null}

      {actions}
    </div>
  );

  return (
    <AdminPageLayout requiredPermission={requiredPermission}>
      <PageHeader
        title={title}
        description={description}
        icon={icon}
        breadcrumbs={breadcrumbs}
        actions={headerActions}
      />

      <Card className="mb-6 border-border/60 bg-card/65 shadow-sm">
        <CardContent className="flex items-center justify-between gap-4 px-6 py-4 text-sm">
          <div>
            <p className="font-medium text-foreground">Separate admin surface, shared settings infrastructure</p>
            <p className="text-muted-foreground">
              This resource uses the shared settings manager abstraction for loading, rendering, and saving.
            </p>
          </div>
          <div className="rounded-full border border-border/70 bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
            {hasChanges ? 'Unsaved changes' : 'Up to date'}
          </div>
        </CardContent>
      </Card>

      {loading ? <LoadingState /> : children}
    </AdminPageLayout>
  );
}
