import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

function AuditLogsHeaderActions({
  loading,
  onRefresh,
  t,
}) {
  return (
    <Button variant="outline" onClick={onRefresh} disabled={loading}>
      <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
      {t('audit.refresh')}
    </Button>
  );
}

export default AuditLogsHeaderActions;
