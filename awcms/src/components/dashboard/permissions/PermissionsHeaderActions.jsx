import { Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

function PermissionsHeaderActions({
  loading,
  onRefresh,
  onCreate,
}) {
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="icon"
        onClick={onRefresh}
        title="Refresh"
        className="h-10 w-10 border-slate-200/70 bg-white/70 shadow-sm hover:bg-white"
      >
        <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
      </Button>
      <Button onClick={onCreate} className="bg-indigo-600 text-white shadow-sm hover:bg-indigo-700">
        <Plus className="mr-2 h-4 w-4" /> New Permission
      </Button>
    </div>
  );
}

export default PermissionsHeaderActions;
