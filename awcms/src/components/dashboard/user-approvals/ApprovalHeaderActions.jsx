import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

function ApprovalHeaderActions({
  loading,
  onRefresh,
}) {
  return (
    <Button variant="ghost" size="icon" onClick={onRefresh} title="Refresh">
      <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
    </Button>
  );
}

export default ApprovalHeaderActions;
