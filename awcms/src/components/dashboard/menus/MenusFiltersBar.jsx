import { Search, ShieldCheck, ShieldOff } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const VISIBILITY_OPTIONS = [
  { value: 'all', label: 'All Links', icon: Search },
  { value: 'public', label: 'Public', icon: ShieldCheck },
  { value: 'restricted', label: 'Restricted', icon: ShieldOff },
];

function MenusFiltersBar({
  searchQuery,
  onChangeSearch,
  visibilityFilter,
  onChangeVisibility,
  duplicateCount,
}) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border/60 bg-card/75 p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
      <div className="relative w-full lg:max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(event) => onChangeSearch(event.target.value)}
          placeholder="Search labels, URLs, or linked pages"
          className="h-11 rounded-xl border-border/70 bg-background pl-10"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {VISIBILITY_OPTIONS.map((option) => {
          const Icon = option.icon;

          return (
            <Button
              key={option.value}
              type="button"
              variant={visibilityFilter === option.value ? 'default' : 'outline'}
              onClick={() => onChangeVisibility(option.value)}
              className="h-10 rounded-xl"
            >
              <Icon className="mr-2 h-4 w-4" />
              {option.label}
            </Button>
          );
        })}

        {duplicateCount > 0 && (
          <span className="rounded-full border border-amber-300/80 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
            {duplicateCount} duplicate links in this scope
          </span>
        )}
      </div>
    </div>
  );
}

export default MenusFiltersBar;
