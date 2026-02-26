import MinCharSearchInput from '@/components/common/MinCharSearchInput';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';

function TenantsListToolbar({
	query,
	setQuery,
	clearSearch,
	loading,
	searchLoading,
	isSearchValid,
	searchMessage,
	minLength,
	itemsPerPage,
	resultCount,
	onItemsPerPageChange,
}) {
	return (
		<div className="flex flex-col items-start justify-between gap-4 border-b border-border/70 bg-gradient-to-r from-primary/10 via-background/30 to-emerald-500/10 p-4 sm:flex-row sm:items-center sm:p-5">
			<div className="w-full max-w-md space-y-1.5">
				<p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Search Workspace</p>
				<MinCharSearchInput
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					onClear={clearSearch}
					loading={loading || searchLoading}
					isValid={isSearchValid}
					message={searchMessage}
					minLength={minLength}
					placeholder="Search tenants"
				/>
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<span className="inline-flex items-center rounded-full border border-border/70 bg-background/80 px-3 py-1.5 text-xs font-medium text-muted-foreground">
					{resultCount} tenants
				</span>
				<div className="flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-2 py-1">
					<span className="px-1 text-xs font-medium text-muted-foreground">Per page</span>
					<Select value={String(itemsPerPage)} onValueChange={(value) => onItemsPerPageChange(Number(value))}>
						<SelectTrigger className="h-8 w-[72px] border-border/70 bg-background text-xs">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="5">5</SelectItem>
							<SelectItem value="10">10</SelectItem>
							<SelectItem value="25">25</SelectItem>
							<SelectItem value="50">50</SelectItem>
						</SelectContent>
					</Select>
				</div>
			</div>
		</div>
	);
}

export default TenantsListToolbar;
