import { Button } from '@/components/ui/button';
import { Languages, RefreshCw, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

function BlogsHeaderActions({
 	t,
 	activeTab,
 	activeView,
 	selectedLanguageLabel,
 	navigate,
 	rebuildRequired,
 	onRebuild,
 	isRebuilding,
 }) {
 	return (
 		<div className="flex flex-wrap items-center gap-2">
			{rebuildRequired && (
				<Button
					variant="outline"
					onClick={onRebuild}
					disabled={isRebuilding}
				className={cn(
					'h-9 rounded-xl px-3 shadow-sm border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20',
					isRebuilding && 'opacity-50'
				)}
				>
					{isRebuilding ? (
						<RefreshCw className="h-3.5 w-3.5 mr-2 animate-spin" />
					) : (
						<AlertTriangle className="h-3.5 w-3.5 mr-2" />
					)}
					{isRebuilding ? 'Rebuilding...' : 'Rebuild Site'}
				</Button>
			)}

			<span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">
				<Languages className="h-3.5 w-3.5" />
				{selectedLanguageLabel}
			</span>

			<Button
				variant={activeView === null && activeTab === 'blogs' ? 'default' : 'outline'}
				onClick={() => navigate('/cmspanel/blogs')}
				className={cn(
					'h-9 rounded-xl px-3 shadow-sm',
					activeView === null && activeTab === 'blogs'
						? 'bg-primary text-primary-foreground hover:opacity-95'
						: 'border-border/70 bg-background/80 text-muted-foreground hover:bg-accent/70 hover:text-foreground'
				)}
			>
				{t('menu.blogs')}
			</Button>

			<Button
				variant={activeView === 'queue' ? 'default' : 'outline'}
				onClick={() => navigate('/cmspanel/blogs/queue')}
				className={cn(
					'h-9 rounded-xl px-3 shadow-sm',
					activeView === 'queue'
						? 'bg-primary text-primary-foreground hover:opacity-95'
						: 'border-border/70 bg-background/80 text-muted-foreground hover:bg-accent/70 hover:text-foreground'
				)}
			>
				{t('common.review_queue', 'Review Queue')}
			</Button>

			<Button
				variant={activeView === 'trash' ? 'default' : 'outline'}
				onClick={() => navigate('/cmspanel/blogs/trash')}
				className={cn(
					'h-9 rounded-xl px-3 shadow-sm',
					activeView === 'trash'
						? 'bg-primary text-primary-foreground hover:opacity-95'
						: 'border-border/70 bg-background/80 text-muted-foreground hover:bg-accent/70 hover:text-foreground'
				)}
			>
				{t('common.trash')}
			</Button>
		</div>
	);
}

export default BlogsHeaderActions;
