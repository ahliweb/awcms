import { Link } from 'react-router-dom';
import { Mail, PlugZap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { usePermissions } from '@/contexts/PermissionContext';
import { usePlugins } from '@/contexts/PluginContext';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';
import EmailSettingsPanel from '@/plugins/mailketing/components/EmailSettings';

function EmailSettingsDisabledState() {
  const { hasPermission, isPlatformAdmin, isFullAccess } = usePermissions();
  const canViewModules = isPlatformAdmin || isFullAccess || hasPermission('platform.module.read');
  const canViewExtensions = isPlatformAdmin || isFullAccess || hasPermission('platform.extensions.read');

  return (
    <Card className="border-border/60 bg-card/70 shadow-sm">
      <CardContent className="space-y-4 p-6">
        <div className="flex items-start gap-3">
          <span className="rounded-xl border border-amber-300/60 bg-amber-100/70 p-3 text-amber-700">
            <PlugZap className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Mailketing is not active</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Email Settings remains visible so operators know where email delivery is configured, but the Mailketing module must be activated before this screen becomes editable.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-border/60 bg-background/70 p-4 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">How to activate it</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>Open the root Modules list and verify the Mailketing module is available and active for this tenant.</li>
            <li>If Mailketing is packaged as an extension in your environment, confirm the extension is installed and enabled.</li>
            <li>Return to this screen to configure the tenant-specific provider settings.</li>
          </ol>
        </div>

        <div className="flex flex-wrap gap-2">
          {canViewModules ? (
            <Button asChild>
              <Link to="/cmspanel/modules">Open Modules</Link>
            </Button>
          ) : null}

          {canViewExtensions ? (
            <Button asChild variant="outline">
              <Link to="/cmspanel/extensions">Open Extensions</Link>
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export default function EmailSettingsManager() {
  const { activePlugins } = usePlugins();
  const isMailketingActive = (activePlugins || []).some((plugin) => plugin.slug === 'mailketing');

  return (
    <AdminPageLayout requiredPermission="tenant.setting.update">
      <PageHeader
        title="Email Settings"
        description="Configure tenant email delivery, sender identity, and Mailketing integration settings."
        icon={Mail}
        breadcrumbs={[{ label: 'Settings' }, { label: 'Email Settings', icon: Mail }]}
      />

      {isMailketingActive ? <EmailSettingsPanel /> : <EmailSettingsDisabledState />}
    </AdminPageLayout>
  );
}
