import { Loader2 } from 'lucide-react';
import { AdminPageLayout } from '@/templates/flowbite-admin';

function TenantSettingsLoadingState() {
  return (
    <AdminPageLayout>
      <div className="grid min-h-[360px] place-items-center rounded-2xl border border-border/60 bg-card/60 p-8">
        <div className="text-center text-muted-foreground">
          <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin" />
          <p className="text-sm font-medium">Loading tenant settings...</p>
        </div>
      </div>
    </AdminPageLayout>
  );
}

export default TenantSettingsLoadingState;
