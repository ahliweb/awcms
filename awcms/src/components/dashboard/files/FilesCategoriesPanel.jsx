import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FolderClosed, FolderPlus } from 'lucide-react';
import { cn } from '@/lib/utils';

function FilesCategoriesPanel({
  categories,
  selectedCategory,
  setSelectedCategory,
  isCreateCategoryOpen,
  setIsCreateCategoryOpen,
  newCategoryName,
  setNewCategoryName,
  handleCreateCategory,
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/65 p-4 shadow-sm backdrop-blur-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Categories</h3>
        <Dialog open={isCreateCategoryOpen} onOpenChange={setIsCreateCategoryOpen}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg border border-border/70 text-muted-foreground hover:bg-accent/70 hover:text-foreground">
              <FolderPlus className="h-4 w-4" />
            </Button>
          </DialogTrigger>
          <DialogContent className="border-border/60">
            <DialogHeader>
              <DialogTitle>Create Category</DialogTitle>
              <DialogDescription>Add a new category to organize your files.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Category Name</label>
                <Input
                  className="rounded-xl border-border/70 bg-background"
                  value={newCategoryName}
                  onChange={(event) => setNewCategoryName(event.target.value)}
                  placeholder="e.g. Marketing, Products"
                />
              </div>
              <Button
                onClick={handleCreateCategory}
                disabled={!newCategoryName.trim()}
                className="rounded-xl bg-primary text-primary-foreground hover:opacity-95"
              >
                Create
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-1">
        <Button
          variant={selectedCategory === null ? 'secondary' : 'ghost'}
          className={cn(
            'w-full justify-start rounded-xl font-normal',
            selectedCategory === null
              ? 'border border-primary/25 bg-primary/10 text-primary'
              : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
          )}
          onClick={() => setSelectedCategory(null)}
        >
          <FolderClosed className="mr-2 h-4 w-4" />
          All Files
        </Button>

        {categories.map((category) => (
          <Button
            key={category.id}
            variant={selectedCategory === category.id ? 'secondary' : 'ghost'}
            className={cn(
              'w-full justify-start truncate rounded-xl font-normal',
              selectedCategory === category.id
                ? 'border border-primary/25 bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
            )}
            onClick={() => setSelectedCategory(category.id)}
            title={category.name}
          >
            <div className="mr-2 flex h-4 w-4 items-center justify-center">#</div>
            <span className="truncate">{category.name}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}

export default FilesCategoriesPanel;
