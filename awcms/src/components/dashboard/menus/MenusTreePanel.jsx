import { Reorder } from 'framer-motion';
import MenuReorderItem from '@/components/dashboard/menus/MenuReorderItem';

function MenusTreePanel({
	loading,
	menus,
	hasActiveFilters,
	canEdit,
	canDelete,
	onEdit,
	onRequestDelete,
	onPerms,
	onReorder,
	onChildReorder,
	isPlatformAdmin,
}) {
	const emptyState = hasActiveFilters
		? 'No menu items match the current filters.'
		: 'No menu items found for this location. Create one to get started.';

	return (
		<div className="min-h-[300px] rounded-2xl border border-border/60 bg-card/75 p-6 shadow-sm">
			{loading ? (
				<div className="flex h-40 items-center justify-center text-muted-foreground">Loading menus...</div>
			) : menus.length === 0 ? (
				<div className="py-12 text-center text-muted-foreground">{emptyState}</div>
			) : (
				<Reorder.Group axis="y" values={menus} onReorder={onReorder} className="space-y-3">
					{menus.map((menu) => (
						<MenuReorderItem
							key={menu.id}
							menu={menu}
							canReorder={!hasActiveFilters}
							canEdit={canEdit}
							canDelete={canDelete}
							onEdit={onEdit}
							onRequestDelete={onRequestDelete}
							onPerms={onPerms}
							onChildReorder={(newChildren) => onChildReorder(menu.id, newChildren)}
							isPlatformAdmin={isPlatformAdmin}
						/>
					))}
				</Reorder.Group>
			)}
		</div>
	);
}

export default MenusTreePanel;
