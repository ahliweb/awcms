import { useState } from 'react';
import { Reorder } from 'framer-motion';
import { ChevronDown, ChevronRight, Edit, GripVertical, Lock, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

function MenuReorderItem({
	menu,
	canReorder,
	canEdit,
	canDelete,
	onEdit,
	onRequestDelete,
	onPerms,
	onChildReorder,
	isPlatformAdmin,
}) {
	const hasChildren = menu.children && menu.children.length > 0;
	const [isOpen, setIsOpen] = useState(true);
  const Wrapper = canReorder ? Reorder.Item : 'div';

	return (
		<Wrapper {...(canReorder ? { value: menu, id: menu.id } : {})} className="overflow-hidden rounded-xl border border-border/60 bg-card/80 shadow-sm select-none">
			<div className="flex items-center gap-3 p-3 transition-colors hover:bg-accent/30">
				<GripVertical className={`h-5 w-5 flex-shrink-0 text-muted-foreground ${canReorder ? 'cursor-grab active:cursor-grabbing' : 'opacity-40'}`} />

				<div className="flex flex-1 flex-col gap-1 overflow-hidden sm:flex-row sm:items-center sm:gap-3">
					{isPlatformAdmin && (
						<span className="rounded border border-border/70 bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
							{menu.tenant?.name || '(Unknown)'}
						</span>
					)}
					<div className="flex items-center gap-2 truncate font-semibold text-foreground">
						{menu.label}
						{!menu.is_active && (
							<span className="rounded border border-destructive/20 bg-destructive/10 px-1.5 py-0.5 text-[10px] text-destructive">
								Inactive
							</span>
						)}
					</div>
					<div className="flex items-center gap-2">
						{menu.page_id && (
							<span className="rounded border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">Page Linked</span>
						)}
						<span className="truncate font-mono text-xs text-muted-foreground">{menu.url}</span>
					</div>
				</div>

				<div className="flex items-center gap-1">
					{hasChildren && (
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setIsOpen(!isOpen)}
							className="mr-1 h-8 w-8 p-0"
						>
							{isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
						</Button>
					)}
					<Button
						variant="ghost"
						size="sm"
						onClick={() => onPerms(menu)}
						title="Access Permissions"
						aria-label={`Manage permissions for ${menu.label}`}
						className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
					>
						<Lock className="h-4 w-4" />
					</Button>
					{canEdit && (
						<Button variant="ghost" size="sm" onClick={() => onEdit(menu)} aria-label={`Edit ${menu.label}`} className="h-8 w-8 p-0 text-primary hover:bg-primary/10">
							<Edit className="h-4 w-4" />
						</Button>
					)}
					{canDelete && (
						<Button
							variant="ghost"
							size="sm"
							onClick={() => onRequestDelete(menu)}
							aria-label={`Delete ${menu.label}`}
							className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10"
						>
							<Trash2 className="h-4 w-4" />
						</Button>
					)}
				</div>
			</div>

			{hasChildren && isOpen && (
				<div className="border-t border-border/60 bg-muted/25 pb-3 pl-10 pr-3 pt-1">
					<Reorder.Group axis="y" values={menu.children} onReorder={onChildReorder} className="space-y-2">
						{menu.children.map((child) => (
							<Wrapper key={child.id} {...(canReorder ? { value: child, id: child.id } : {})} className="flex items-center justify-between rounded-lg border border-border/60 bg-background/80 p-2 shadow-sm">
								<div className="flex items-center gap-3">
									<GripVertical className={`h-4 w-4 text-muted-foreground ${canReorder ? 'cursor-grab' : 'opacity-40'}`} />
									<div className="flex flex-col">
										<span className="text-sm font-medium text-foreground">{child.label}</span>
										<div className="flex items-center gap-2">
											{child.page_id && (
												<span className="rounded border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">Page</span>
											)}
											<span className="text-xs text-muted-foreground">{child.url}</span>
										</div>
									</div>
								</div>
								<div className="flex gap-1">
									<Button variant="ghost" size="icon" aria-label={`Manage permissions for ${child.label}`} className="h-6 w-6" onClick={() => onPerms(child)}>
										<Lock className="h-3 w-3 text-muted-foreground" />
									</Button>
									<Button variant="ghost" size="icon" aria-label={`Edit ${child.label}`} className="h-6 w-6" onClick={() => onEdit(child)}>
										<Edit className="h-3 w-3 text-primary" />
									</Button>
									<Button variant="ghost" size="icon" aria-label={`Delete ${child.label}`} className="h-6 w-6" onClick={() => onRequestDelete(child)}>
										<Trash2 className="h-3 w-3 text-destructive" />
									</Button>
								</div>
							</Wrapper>
						))}
					</Reorder.Group>
				</div>
			)}
		</Wrapper>
	);
}

export default MenuReorderItem;
