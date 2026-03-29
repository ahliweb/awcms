import { Power, Puzzle, RefreshCw, Search, Settings, Shield, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

function ExtensionsInstalledTab({
	t,
	loading,
	searchTerm,
	setSearchTerm,
	searchActive,
	extensions,
	filteredExtensions,
	user,
	isSuperAdmin,
	canManageGlobal,
	onEdit,
	onDelete,
	onToggleStatus,
	onSelectAbac,
	onRefresh,
}) {
	return (
		<div className="space-y-4 mt-4">
			<div className="rounded-2xl border border-border/60 bg-card/65 p-4 shadow-sm backdrop-blur-sm">
				<div className="grid gap-3 lg:grid-cols-[minmax(260px,420px)_1fr_auto] lg:items-center">
					<div className="relative max-w-xl">
						<Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
						<Input
							placeholder={t('common.search')}
							value={searchTerm}
							onChange={(event) => setSearchTerm(event.target.value)}
							className="h-10 rounded-xl border-border/70 bg-background pl-9"
						/>
					</div>

					<div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm">
						<span className="inline-flex items-center rounded-full border border-border/70 bg-background/70 px-3 py-1.5 text-muted-foreground">
							Total: <span className="ml-1 font-semibold text-foreground">{extensions.length}</span>
						</span>
						<span className="inline-flex items-center rounded-full border border-border/70 bg-background/70 px-3 py-1.5 text-muted-foreground">
							Visible: <span className="ml-1 font-semibold text-foreground">{filteredExtensions.length}</span>
						</span>
						{searchActive ? (
							<Button
								variant="ghost"
								size="sm"
								onClick={() => setSearchTerm('')}
								className="h-8 rounded-full border border-border/70 px-3 text-muted-foreground hover:bg-accent/60 hover:text-foreground"
							>
								Clear
							</Button>
						) : null}
					</div>

					<Button
						variant="outline"
						onClick={onRefresh}
						disabled={loading}
						className="h-10 rounded-xl border-border/70 bg-background/75 px-3 text-muted-foreground hover:bg-accent/70 hover:text-foreground"
					>
						<RefreshCw className={cn('mr-1.5 h-4 w-4', loading && 'animate-spin')} />
						{t('common.refresh')}
					</Button>
				</div>
			</div>

			{loading ? (
				<div className="py-12 text-center text-muted-foreground">{t('common.loading')}</div>
			) : filteredExtensions.length === 0 ? (
				<div className="rounded-2xl border border-dashed border-border/70 bg-card/55 py-16 text-center">
					<Puzzle className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
						<h3 className="text-lg font-semibold text-foreground">{t('extensions.empty_title')}</h3>
						<p className="text-sm text-muted-foreground">
							{searchActive ? t('extensions.empty_search') : t('extensions.empty_default')}
						</p>
				</div>
			) : (
				<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
					{filteredExtensions.map((extension) => {
						const isOwner = user?.id === extension.created_by;
						const canManageThis = isSuperAdmin || isOwner;

						return (
							<div key={extension.id} className={cn('flex flex-col rounded-2xl border bg-card/75 shadow-sm transition-all', extension.is_active ? 'border-primary/25 ring-1 ring-primary/10' : 'border-border/60 hover:border-border')}>
								<div className="p-5 flex-1">
									<div className="mb-4 flex items-start justify-between">
										<div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border/60 bg-background/80 text-xl text-foreground">{extension.icon || <Puzzle />}</div>
										<Badge variant={extension.is_active ? 'default' : 'secondary'}>{extension.is_active ? t('extensions.status_active') : t('extensions.status_inactive')}</Badge>
									</div>
									<h3 className="mb-1 text-lg font-bold text-foreground">{extension.name}</h3>
									<p className="mb-3 line-clamp-2 text-sm text-muted-foreground">{extension.description}</p>
									<div className="flex flex-wrap gap-1">
										{extension.config?.routes?.length > 0 && <span className="rounded-full border border-border/70 bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{extension.config.routes.length} Routes</span>}
										{extension.config?.menus?.length > 0 && <span className="rounded-full border border-border/70 bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{extension.config.menus.length} Menus</span>}
									</div>
									{isOwner && <span className="mt-2 inline-flex items-center rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">Your Extension</span>}
								</div>

								<div className="flex items-center justify-between rounded-b-2xl border-t border-border/60 bg-card/60 p-4">
									<div className="flex gap-1">
										{canManageThis && (
											<Button variant="ghost" size="sm" onClick={() => onEdit(extension)} title={t('extensions.configure')} className="text-muted-foreground hover:text-foreground"><Settings className="w-4 h-4" /></Button>
										)}
										{canManageGlobal && (
										<Button variant="ghost" size="sm" onClick={() => onSelectAbac(extension)} title={t('extensions.permissions')} className="text-muted-foreground hover:text-foreground"><Shield className="w-4 h-4" /></Button>
									)}
										{canManageThis && (
											<Button variant="ghost" size="sm" onClick={() => onDelete(extension)} className="text-destructive hover:text-destructive hover:bg-destructive/10"><Trash2 className="w-4 h-4" /></Button>
										)}
									</div>

									{isSuperAdmin && (
										<Button
											size="sm"
											variant={extension.is_active ? 'outline' : 'default'}
											className={cn(
												'rounded-lg',
												extension.is_active
													? 'border-border/70 text-muted-foreground hover:text-foreground'
													: 'bg-primary text-primary-foreground hover:opacity-95'
											)}
											onClick={() => onToggleStatus(extension)}
										>
											<Power className="mr-2 h-3 w-3" /> {extension.is_active ? t('extensions.deactivate') : t('extensions.activate')}
										</Button>
									)}
								</div>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}

export default ExtensionsInstalledTab;
