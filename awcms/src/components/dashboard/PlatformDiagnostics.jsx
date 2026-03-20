import { Building2, CloudCog, Database, ShieldCheck } from 'lucide-react';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';
import { usePermissions } from '@/contexts/PermissionContext';
import { useTenant } from '@/contexts/TenantContext';

function PlatformDiagnostics() {
  const { role, tenantId, isPlatformAdmin, isFullAccess } = usePermissions();
  const { currentTenant, resolvedTenant, platformTenantScopeId } = useTenant();

  return (
    <AdminPageLayout requiredPermission="platform.tenant.read">
      <PageHeader
        title="Platform Diagnostics"
        description="Inspect active platform scope, tenant scope, and runtime guarantees across the centralized admin system."
        icon={CloudCog}
        breadcrumbs={[]}
      />

      <div className="grid gap-6 text-sm lg:grid-cols-3">
        <div className="rounded-2xl border border-border/60 bg-card/65 p-6 shadow-sm backdrop-blur-sm">
          <div className="mb-4 flex items-center gap-2 text-foreground font-semibold">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Scope & Access
          </div>
          <div className="space-y-3 text-muted-foreground">
            <div className="flex justify-between gap-4"><span>Active role</span><span className="font-medium text-foreground">{role?.name || 'Unknown'}</span></div>
            <div className="flex justify-between gap-4"><span>Role scope</span><span className="font-medium text-foreground">{role?.scope || 'tenant'}</span></div>
            <div className="flex justify-between gap-4"><span>Platform access</span><span className="font-medium text-foreground">{isPlatformAdmin || isFullAccess ? 'Full' : 'Tenant'}</span></div>
          </div>
        </div>

        <div className="rounded-2xl border border-border/60 bg-card/65 p-6 shadow-sm backdrop-blur-sm">
          <div className="mb-4 flex items-center gap-2 text-foreground font-semibold">
            <Building2 className="h-4 w-4 text-primary" />
            Tenant Scope
          </div>
          <div className="space-y-3 text-muted-foreground">
            <div className="flex justify-between gap-4"><span>Resolved tenant</span><span className="font-medium text-foreground">{resolvedTenant?.name || 'None'}</span></div>
            <div className="flex justify-between gap-4"><span>Active scope</span><span className="font-medium text-foreground">{currentTenant?.name || 'None'}</span></div>
            <div className="flex justify-between gap-4"><span>Scoped override</span><span className="font-medium text-foreground">{platformTenantScopeId && platformTenantScopeId !== resolvedTenant?.id ? 'Enabled' : 'Default'}</span></div>
            <div className="flex justify-between gap-4"><span>RLS tenant id</span><span className="font-medium text-foreground">{currentTenant?.id || tenantId || 'None'}</span></div>
          </div>
        </div>

        <div className="rounded-2xl border border-border/60 bg-card/65 p-6 shadow-sm backdrop-blur-sm">
          <div className="mb-4 flex items-center gap-2 text-foreground font-semibold">
            <Database className="h-4 w-4 text-primary" />
            Storage & Edge
          </div>
          <div className="space-y-3 text-muted-foreground">
            <div className="flex justify-between gap-4"><span>Object storage</span><span className="font-medium text-foreground">Cloudflare R2</span></div>
            <div className="flex justify-between gap-4"><span>Function runtime</span><span className="font-medium text-foreground">Cloudflare Edge</span></div>
            <div className="flex justify-between gap-4"><span>Supabase Storage</span><span className="font-medium text-foreground">Blocked</span></div>
            <div className="flex justify-between gap-4"><span>Supabase Edge Functions</span><span className="font-medium text-foreground">Disabled</span></div>
          </div>
        </div>
      </div>
    </AdminPageLayout>
  );
}

export default PlatformDiagnostics;
