import { Copy, LayoutTemplate, Lock, Menu, ShieldCheck } from 'lucide-react';

function MenusOverviewCards({
	flatMenus,
	rolesCount,
	currentLocationLabel,
	portalVariantLabel,
	duplicateCount,
}) {
	const publicItemsCount = flatMenus.filter((item) => item.is_public).length;
	const restrictedItemsCount = Math.max(0, flatMenus.length - publicItemsCount);
	const childItemsCount = flatMenus.filter((item) => item.parent_id).length;

	return (
		<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
			<div className="rounded-2xl border border-border/60 bg-card/65 p-4 shadow-sm backdrop-blur-sm">
				<div className="flex items-start justify-between gap-3">
					<div>
						<p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Total Items</p>
						<p className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{flatMenus.length}</p>
						<p className="text-xs text-muted-foreground">Menu links in this scope</p>
					</div>
					<span className="rounded-xl border border-border/70 bg-background/70 p-2 text-primary">
						<Menu className="h-4 w-4" />
					</span>
				</div>
			</div>

			<div className="rounded-2xl border border-border/60 bg-card/65 p-4 shadow-sm backdrop-blur-sm">
				<div className="flex items-start justify-between gap-3">
					<div>
						<p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Public Default</p>
						<p className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{publicItemsCount}</p>
						<p className="text-xs text-muted-foreground">Visible without signed-in role checks</p>
					</div>
					<span className="rounded-xl border border-primary/25 bg-primary/10 p-2 text-primary">
						<ShieldCheck className="h-4 w-4" />
					</span>
				</div>
			</div>

			<div className="rounded-2xl border border-border/60 bg-card/65 p-4 shadow-sm backdrop-blur-sm">
				<div className="flex items-start justify-between gap-3">
					<div>
						<p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Nested Items</p>
						<p className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{childItemsCount}</p>
						<p className="text-xs text-muted-foreground">Child menu entries</p>
					</div>
					<span className="rounded-xl border border-border/70 bg-background/70 p-2 text-primary">
						<LayoutTemplate className="h-4 w-4" />
					</span>
				</div>
			</div>

			<div className="rounded-2xl border border-border/60 bg-card/65 p-4 shadow-sm backdrop-blur-sm">
				<div className="flex items-start justify-between gap-3">
					<div>
						<p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Access Rules</p>
						<p className="mt-1 text-sm font-semibold text-foreground">{rolesCount} roles · {restrictedItemsCount} restricted</p>
						<p className="text-xs text-muted-foreground">{portalVariantLabel} · {currentLocationLabel}</p>
					</div>
					<span className="rounded-xl border border-primary/25 bg-primary/10 p-2 text-primary">
						<Lock className="h-4 w-4" />
					</span>
				</div>
			</div>

			<div className="rounded-2xl border border-border/60 bg-card/65 p-4 shadow-sm backdrop-blur-sm sm:col-span-2 xl:col-span-1">
				<div className="flex items-start justify-between gap-3">
					<div>
						<p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Duplicate Links</p>
						<p className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{duplicateCount}</p>
						<p className="text-xs text-muted-foreground">Clean up repeated URLs per locale and location</p>
					</div>
					<span className="rounded-xl border border-amber-300/60 bg-amber-50 p-2 text-amber-700">
						<Copy className="h-4 w-4" />
					</span>
				</div>
			</div>
		</div>
	);
}

export default MenusOverviewCards;
