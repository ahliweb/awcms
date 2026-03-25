import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

function TagsHeaderActions({
  showTrash,
  canSoftDelete,
  canCreate,
  onToggleTrash,
  onCreate,
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {(canSoftDelete || showTrash) && (
        <Button
          variant={showTrash ? 'destructive' : 'outline'}
          onClick={onToggleTrash}
          className={showTrash ? 'h-10 rounded-xl bg-destructive px-4 text-destructive-foreground hover:bg-destructive/90' : 'h-10 rounded-xl border-border/70 bg-background px-4 text-muted-foreground hover:text-foreground'}
        >
          {showTrash ? 'View Active Tags' : 'Trash / Deleted'}
          <Trash2 className="ml-2 h-4 w-4" />
        </Button>
      )}

      {!showTrash && canCreate && (
        <Button onClick={onCreate} className="h-10 rounded-xl bg-primary px-4 text-primary-foreground hover:bg-primary/90">
          <Plus className="mr-2 h-4 w-4" /> Create Tag
        </Button>
      )}
    </div>
  );
}

export default TagsHeaderActions;
