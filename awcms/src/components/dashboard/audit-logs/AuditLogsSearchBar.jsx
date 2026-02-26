import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';

function AuditLogsSearchBar({
  searchQuery,
  setSearchQuery,
  t,
}) {
  return (
    <div className="flex items-center gap-4 rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="relative max-w-md flex-1">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={t('audit.search_placeholder')}
          className="border-input bg-background pl-9"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
        />
      </div>
    </div>
  );
}

export default AuditLogsSearchBar;
