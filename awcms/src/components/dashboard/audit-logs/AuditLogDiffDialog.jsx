import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

function AuditLogDiffDialog({
  selectedLog,
  setSelectedLog,
  t,
}) {
  return (
    <Dialog open={!!selectedLog} onOpenChange={() => setSelectedLog(null)}>
      <DialogContent className="flex max-h-[80vh] max-w-3xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t('audit.diff.title')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto p-1">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-destructive">
                {t('audit.diff.old_value')}
              </h4>
              <pre className="min-h-[150px] overflow-x-auto rounded border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
                {selectedLog?.old_value
                  ? JSON.stringify(JSON.parse(selectedLog.old_value), null, 2)
                  : 'null'}
              </pre>
            </div>

            <div className="space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-green-600 dark:text-green-400">
                {t('audit.diff.new_value')}
              </h4>
              <pre className="min-h-[150px] overflow-x-auto rounded border border-green-200 bg-green-100 p-3 text-xs text-green-800 dark:border-green-800 dark:bg-green-900/30 dark:text-green-300">
                {selectedLog?.new_value
                  ? JSON.stringify(JSON.parse(selectedLog.new_value), null, 2)
                  : 'null'}
              </pre>
            </div>
          </div>

          <div className="space-y-2 border-t border-border pt-4 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('audit.diff.action')}:</span>
              <span className="font-medium text-foreground">{selectedLog?.action}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('audit.diff.resource')}:</span>
              <span className="font-medium text-foreground">{selectedLog?.resource}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('audit.diff.ip_address')}:</span>
              <span className="font-mono text-xs text-foreground">{selectedLog?.ip_address || 'N/A'}</span>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default AuditLogDiffDialog;
