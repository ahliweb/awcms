import { format } from 'date-fns';
import { Eye, Globe, Server, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import AuditLogsActionBadge from '@/components/dashboard/audit-logs/AuditLogsActionBadge';

function AuditLogsTable({
  loading,
  logs,
  setSelectedLog,
  t,
}) {
  const getChannelIcon = (channel) => {
    switch (channel) {
      case 'mobile':
        return <Smartphone className="h-3 w-3" />;
      case 'api':
        return <Server className="h-3 w-3" />;
      default:
        return <Globe className="h-3 w-3" />;
    }
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-muted/50">
          <tr>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">{t('audit.table.timestamp')}</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">{t('audit.table.user')}</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">{t('audit.table.ip_address')}</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">{t('audit.table.action')}</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">{t('audit.table.resource')}</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">{t('audit.table.changes')}</th>
            <th className="px-4 py-3 text-center font-medium text-muted-foreground">{t('audit.table.channel')}</th>
          </tr>
        </thead>

        <tbody className="divide-y divide-border">
          {loading ? (
            <tr>
              <td colSpan="7" className="p-8 text-center text-muted-foreground">
                {t('audit.table.loading')}
              </td>
            </tr>
          ) : logs.length === 0 ? (
            <tr>
              <td colSpan="7" className="p-8 text-center text-muted-foreground">
                {t('audit.table.no_logs')}
              </td>
            </tr>
          ) : (
            logs.map((log) => (
              <tr key={log.id} className="transition-colors hover:bg-muted/50">
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                  {format(new Date(log.created_at), 'MMM dd, yyyy HH:mm:ss')}
                </td>

                <td className="px-4 py-3">
                  <div className="font-medium text-foreground">
                    {log.user?.full_name || t('audit.table.unknown_user')}
                  </div>
                  <div className="text-xs text-muted-foreground">{log.user?.email}</div>
                </td>

                <td className="px-4 py-3">
                  <span className="font-mono text-xs text-muted-foreground">{log.ip_address || '-'}</span>
                </td>

                <td className="px-4 py-3">
                  <AuditLogsActionBadge action={log.action} />
                </td>

                <td className="px-4 py-3 text-muted-foreground">
                  <div className="font-medium text-foreground">{log.resource}</div>
                  {log.resource_id && <div className="text-xs text-muted-foreground">#{log.resource_id}</div>}
                </td>

                <td className="px-4 py-3">
                  {log.old_value || log.new_value ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedLog(log)}
                      className="h-7 px-2 text-xs text-primary hover:text-primary/80"
                    >
                      <Eye className="mr-1 h-3 w-3" /> {t('audit.table.view_diff')}
                    </Button>
                  ) : (
                    <span className="text-xs italic text-muted-foreground">{t('audit.table.no_modifications')}</span>
                  )}
                </td>

                <td className="px-4 py-3">
                  <div
                    className="flex items-center justify-center gap-1 text-xs font-semibold uppercase text-muted-foreground"
                    title={log.user_agent}
                  >
                    {getChannelIcon(log.channel)}
                    <span>{log.channel || 'web'}</span>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export default AuditLogsTable;
