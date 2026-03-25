import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tag, Palette } from 'lucide-react';

function TagEditorDialog({
  dialogOpen,
  setDialogOpen,
  editingTag,
  formData,
  setFormData,
  handleSave,
  saving,
}) {
  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent className="overflow-hidden rounded-3xl border border-border/70 p-0 shadow-xl sm:max-w-[560px]">
        <DialogHeader className="border-b border-border/70 bg-gradient-to-br from-background via-background to-primary/5 px-6 py-5">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-sm">
              <Tag className="h-5 w-5" />
            </span>
            <div className="space-y-1">
              <DialogTitle>{editingTag ? 'Edit Tag' : 'Create New Tag'}</DialogTitle>
              <DialogDescription>
                {editingTag
                  ? 'Update tag details. Changes reflect across all modules immediately.'
                  : 'Create a reusable tenant tag for editors, selectors, and taxonomy filters.'}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-6 px-6 py-6">
          <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_220px]">
            <div className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="name">Name <span className="text-destructive">*</span></Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(event) => {
                    setFormData((prev) => ({
                      ...prev,
                      name: event.target.value,
                      slug: !editingTag ? event.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-') : prev.slug,
                    }));
                  }}
                  placeholder="e.g. Technology"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="slug">Slug</Label>
                <Input
                  id="slug"
                  value={formData.slug}
                  onChange={(event) => setFormData((prev) => ({ ...prev, slug: event.target.value }))}
                  placeholder="e.g. technology"
                />
                <p className="text-xs text-muted-foreground">Used for stable tag matching across blog, page, and shared taxonomy workflows.</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Input
                  id="description"
                  value={formData.description}
                  onChange={(event) => setFormData((prev) => ({ ...prev, description: event.target.value }))}
                  placeholder="Optional editor-facing context"
                />
              </div>
            </div>

            <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
              <div className="mb-4 flex items-center gap-2 text-sm font-medium text-foreground">
                <Palette className="h-4 w-4 text-primary" />
                Tag Appearance
              </div>
              <div className="space-y-4">
                <div className="flex items-center gap-3 rounded-2xl border border-border/70 bg-background px-3 py-3 shadow-sm">
                  <Input
                    id="color"
                    type="color"
                    value={formData.color}
                    onChange={(event) => setFormData((prev) => ({ ...prev, color: event.target.value }))}
                    className="h-11 w-12 cursor-pointer border-input bg-transparent p-1"
                  />
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Color</p>
                    <p className="font-mono text-sm uppercase text-foreground">{formData.color}</p>
                  </div>
                </div>

                <div className="rounded-2xl border border-border/70 bg-background p-4 shadow-sm">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Preview</p>
                  <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-border/70 bg-secondary px-3 py-2 text-sm text-secondary-foreground">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: formData.color }} />
                    {formData.name || 'New Tag'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="is_active"
                checked={formData.is_active}
                onChange={(event) => setFormData((prev) => ({ ...prev, is_active: event.target.checked }))}
                className="h-4 w-4 rounded border-input bg-background text-primary focus:ring-primary"
              />
              <div>
                <Label htmlFor="is_active" className="font-medium text-foreground">Active tag</Label>
                <p className="text-sm text-muted-foreground">Keep this enabled to show the tag in selectors, pickers, and autocomplete inputs.</p>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="border-t border-border/70 bg-muted/10 px-6 py-4">
          <Button variant="outline" onClick={() => setDialogOpen(false)} className="rounded-xl">Cancel</Button>
          <Button onClick={handleSave} disabled={saving} className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90">
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default TagEditorDialog;
