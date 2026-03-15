
import { useEffect, useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Terminal } from 'lucide-react';
import { useTenant } from '@/contexts/TenantContext';
import { listExtensionLifecycleLogs } from '@/lib/extensionCatalog';

const levelByStatus = {
  succeeded: 'success',
  failed: 'error',
  warning: 'warning',
};

function ExtensionLogs() {
  const { currentTenant } = useTenant();
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    const loadLogs = async () => {
      const data = await listExtensionLifecycleLogs({ tenantId: currentTenant?.id || null });
      setLogs((data || []).map((entry) => ({
        id: entry.id,
        timestamp: entry.created_at,
        level: levelByStatus[entry.status] || 'info',
        message: `${entry.action} • ${entry.metadata?.extensionKey || entry.metadata?.slug || 'extension'}`,
      })));
    };

    loadLogs();
  }, [currentTenant?.id]);

  return (
    <Card className="h-full border-border/60 bg-card/75">
      <CardHeader className="border-b border-border/60 pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Terminal className="h-5 w-5 text-primary" />
          System Logs
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[400px] p-4">
          <div className="space-y-2 font-mono text-sm">
            {logs.map(log => (
              <div key={log.id} className="flex gap-3 items-start">
                <span className="mt-0.5 whitespace-nowrap text-xs text-muted-foreground">
                  {new Date(log.timestamp).toLocaleTimeString()}
                </span>
                <div className="flex-1 break-all">
                  <span className={`
                         mr-2 uppercase text-[10px] font-bold px-1.5 py-0.5 rounded
                        ${log.level === 'info' ? 'border border-primary/20 bg-primary/10 text-primary' : ''}
                        ${log.level === 'success' ? 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : ''}
                        ${log.level === 'warning' ? 'border border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-500' : ''}
                        ${log.level === 'error' ? 'border border-destructive/20 bg-destructive/10 text-destructive' : ''}
                     `}>
                    {log.level}
                  </span>
                  <span className="text-foreground">{log.message}</span>
                </div>
              </div>
            ))}
            <div className="mt-4 border-t border-dashed border-border/70 pt-2 text-xs text-muted-foreground">
              End of recent logs
            </div>
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

export default ExtensionLogs;
