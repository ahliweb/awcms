import { Mail } from 'lucide-react';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';
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

      <EmailLogsPanel />
    </AdminPageLayout>
  );
}
