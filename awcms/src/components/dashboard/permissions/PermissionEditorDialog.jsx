import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function PermissionEditorDialog({
  open,
  onOpenChange,
  editingPermission,
  formData,
  setFormData,
  onSave,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editingPermission ? 'Edit Permission' : 'New Permission'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={onSave} className="space-y-4">
          <div>
            <Label>Name (e.g. view_blogs)</Label>
            <Input
              value={formData.name}
              onChange={(event) => setFormData({ ...formData, name: event.target.value })}
              required
              className="h-11 rounded-xl border-slate-200/70 bg-white/90 shadow-sm focus:border-indigo-500/60 focus:ring-indigo-500/30"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Resource</Label>
              <Input
                value={formData.resource}
                onChange={(event) => setFormData({ ...formData, resource: event.target.value })}
                required
                className="h-11 rounded-xl border-slate-200/70 bg-white/90 shadow-sm focus:border-indigo-500/60 focus:ring-indigo-500/30"
              />
            </div>
            <div>
              <Label>Action</Label>
              <Input
                value={formData.action}
                onChange={(event) => setFormData({ ...formData, action: event.target.value })}
                required
                className="h-11 rounded-xl border-slate-200/70 bg-white/90 shadow-sm focus:border-indigo-500/60 focus:ring-indigo-500/30"
              />
            </div>
          </div>

          <div>
            <Label>Description</Label>
            <Input
              value={formData.description}
              onChange={(event) => setFormData({ ...formData, description: event.target.value })}
              className="h-11 rounded-xl border-slate-200/70 bg-white/90 shadow-sm focus:border-indigo-500/60 focus:ring-indigo-500/30"
            />
          </div>

          <DialogFooter>
            <Button type="submit" className="bg-indigo-600 text-white hover:bg-indigo-700">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default PermissionEditorDialog;
