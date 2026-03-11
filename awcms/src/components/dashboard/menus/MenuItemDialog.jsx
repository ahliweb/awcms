import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
function MenuItemDialog({
	open,
	onOpenChange,
	editingMenu,
	currentLocation,
	menuLocations,
	menuFormData,
	setMenuFormData,
	selectedModule,
	onModuleSelect,
	pages,
	onPageSelect,
	flatMenus,
	moduleGroups,
	onSave,
}) {
	const activeLocationLabel = menuLocations.find((location) => location.id === currentLocation)?.label;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[500px] border-border/60">
				<DialogHeader>
					<DialogTitle>{editingMenu ? 'Edit Menu Item' : 'Create Menu Item'}</DialogTitle>
					<DialogDescription>
						Configure the details for this navigation link in <strong>{activeLocationLabel}</strong>.
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={onSave} className="space-y-4 py-4">
					{!editingMenu && (
						<div className="space-y-2">
							<Label htmlFor="menu-quick-select">Quick Select (Optional)</Label>
							<select
								id="menu-quick-select"
								className="flex h-10 w-full rounded-md border border-border/70 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
								value={selectedModule}
								onChange={(event) => onModuleSelect(event.target.value)}
							>
								<option value="">-- Select a module or enter custom --</option>
								{Object.entries(moduleGroups || {}).map(([group, modules]) => (
									<optgroup key={group} label={group}>
										{modules.map((module) => (
											<option key={module.key} value={module.key}>{module.label} ({module.url})</option>
										))}
									</optgroup>
								))}
							</select>
						</div>
					)}

					<div className="space-y-2">
						<Label htmlFor="menu-page-link">Link to Page (Optional)</Label>
						<select
							id="menu-page-link"
							className="flex h-10 w-full rounded-md border border-border/70 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
							value={menuFormData.page_id || ''}
							onChange={(event) => onPageSelect(event.target.value)}
						>
							<option value="">-- No Page Linked --</option>
							{pages.map((page) => (
								<option key={page.id} value={page.id}>{page.title} ({page.slug})</option>
							))}
						</select>
						</div>

					<div className="grid grid-cols-2 gap-4">
						<div className="space-y-2">
							<Label htmlFor="menu-slug">Slug</Label>
							<Input
								id="menu-slug"
								value={menuFormData.slug || ''}
								onChange={(event) => setMenuFormData({ ...menuFormData, slug: event.target.value })}
								placeholder="about-us"
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="menu-location">Location</Label>
							<select
								id="menu-location"
								className="flex h-10 w-full rounded-md border border-border/70 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
								value={menuFormData.location || currentLocation}
								onChange={(event) => setMenuFormData({ ...menuFormData, location: event.target.value })}
							>
								{menuLocations.map((location) => (
									<option key={location.id} value={location.id}>{location.label}</option>
								))}
							</select>
						</div>
					</div>

					<div className="grid grid-cols-2 gap-4">
						<div className="space-y-2">
							<Label htmlFor="menu-label">Label</Label>
							<Input
								id="menu-label"
								value={menuFormData.label}
								onChange={(event) => setMenuFormData({ ...menuFormData, label: event.target.value })}
								placeholder="e.g. About Us"
								required
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="menu-internal-name">Internal Name</Label>
							<Input
								id="menu-internal-name"
								value={menuFormData.name}
								onChange={(event) => setMenuFormData({ ...menuFormData, name: event.target.value })}
								placeholder="about_us"
							/>
						</div>
					</div>

					<div className="space-y-2">
						<Label htmlFor="menu-url">URL Path</Label>
						<Input
							id="menu-url"
							value={menuFormData.url}
							onChange={(event) => setMenuFormData({ ...menuFormData, url: event.target.value })}
							placeholder="e.g. /about or https://google.com"
							required
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="menu-parent">Parent Menu</Label>
						<select
							id="menu-parent"
							className="flex h-10 w-full rounded-md border border-border/70 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
							value={menuFormData.parent_id || ''}
							onChange={(event) => setMenuFormData({ ...menuFormData, parent_id: event.target.value || null })}
						>
							<option value="">No Parent (Top Level)</option>
							{flatMenus
								.filter((menu) => menu.id !== editingMenu?.id && !menu.parent_id)
								.map((menu) => (
									<option key={menu.id} value={menu.id}>{menu.label}</option>
								))}
						</select>
					</div>

					<div className="flex gap-6 pt-2">
						<label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
							<input
								type="checkbox"
								checked={menuFormData.is_active === true}
								onChange={(event) => setMenuFormData({ ...menuFormData, is_active: event.target.checked })}
								className="rounded border-border/70 text-primary focus:ring-primary"
							/>
							Active
						</label>
						<label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
							<input
								type="checkbox"
								checked={menuFormData.is_public === true}
								onChange={(event) => setMenuFormData({ ...menuFormData, is_public: event.target.checked })}
								className="rounded border-border/70 text-primary focus:ring-primary"
							/>
							Public Default
						</label>
					</div>
					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
						<Button type="submit">Save Changes</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

export default MenuItemDialog;
