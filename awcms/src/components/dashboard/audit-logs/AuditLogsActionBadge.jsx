import { Badge } from '@/components/ui/badge';

const ACTION_COLORS = {
  create: 'border-green-200 bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  update: 'border-blue-200 bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  delete: 'border-destructive/20 bg-destructive/10 text-destructive',
  publish: 'border-purple-200 bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  login: 'border-cyan-200 bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300',
};

function AuditLogsActionBadge({ action }) {
  const type = action?.split('.')[1] || action;
  const colorClass = ACTION_COLORS[type] || 'border-border bg-muted text-muted-foreground';

  return (
    <Badge variant="outline" className={`${colorClass} font-mono text-[10px] uppercase`}>
      {action}
    </Badge>
  );
}

export default AuditLogsActionBadge;
