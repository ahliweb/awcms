import { Mail } from 'lucide-react';
import { AdminPageLayout, PageHeader } from '@/templates/emdash-admin';
import EmailLogsPanel from '@/plugins/mailketing/components/EmailLogs';

export default function EmailLogsManager() {
  return (
    <AdminPageLayout requiredPermission="tenant.setting.read">
      <PageHeader
        title="Email Logs"
        description="Review email delivery history, recipient events, and tenant email activity."
        icon={Mail}
        breadcrumbs={[{ label: 'Settings' }, { label: 'Email Logs', icon: Mail }]}
      />

      <div className="mb-6 overflow-hidden rounded-2xl border border-border/60 bg-card/70 shadow-sm backdrop-blur-sm">
        <div className="bg-gradient-to-r from-primary/12 via-background/40 to-sky-500/12 p-4 sm:p-5">
          <h3 className="text-base font-semibold text-foreground">Delivery audit workspace</h3>
          <p className="mt-1 text-sm text-muted-foreground">Review recipient events and delivery outcomes without leaving the tenant email operations flow.</p>
        </div>
      </div>

      <EmailLogsPanel />
    </AdminPageLayout>
  );
}
