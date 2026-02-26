import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

function SSOHeaderActions({
  loading,
  onRefresh,
  t,
}) {
  return (
    <Button onClick={onRefresh} variant="outline" className="gap-2" disabled={loading}>
      <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
      {t('common.refresh')}
    </Button>
  );
}

export default SSOHeaderActions;
