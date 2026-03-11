import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';

function MenuPermissionsDialog({
	open,
	onOpenChange,
	selectedMenu,
	roles,
	menuPermissions,
	setMenuPermissions,
	onSave,
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-md border-border/60">
				<DialogHeader>
					<DialogTitle>Manage Access: {selectedMenu?.label}</DialogTitle>
					<DialogDescription>
						Toggle which roles can view this menu item in the public interface.
					</DialogDescription>
				</DialogHeader>
				<div className="max-h-[300px] space-y-3 overflow-y-auto py-4">
					{roles.map((role) => (
						<div key={role.id} className="flex items-center justify-between rounded-lg border border-border/70 bg-muted/30 p-3">
							<span className="font-medium text-foreground">{role.name}</span>
							<label className="flex cursor-pointer items-center gap-2">
								<input
									type="checkbox"
									aria-label={`Allow ${role.name}`}
									checked={menuPermissions[role.id] || false}
									onChange={(event) => setMenuPermissions({
										...menuPermissions,
										[role.id]: event.target.checked,
									})}
									className="h-4 w-4 rounded border-border/70 text-primary focus:ring-primary"
								/>
								<span className="text-xs font-semibold uppercase text-muted-foreground">Allow</span>
							</label>
						</div>
					))}
				</div>
				<DialogFooter>
					<Button onClick={onSave}>Save Permissions</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

export default MenuPermissionsDialog;
