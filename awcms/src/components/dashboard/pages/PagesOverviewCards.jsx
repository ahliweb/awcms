import { FileText, Layers, Paintbrush, Sparkles } from 'lucide-react';

function PagesOverviewCards({
	t,
	onlyVisual,
	activeTab,
	isTrashView,
}) {
	return (
		<div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
			<div className="rounded-2xl border border-border/60 bg-card/65 p-4 shadow-sm backdrop-blur-sm">
				<div className="flex items-start justify-between gap-3">
					<div>
						<p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t('common.section', 'Section')}</p>
						<p className="mt-1 text-sm font-semibold capitalize text-foreground">{onlyVisual ? t('pages.visual_title') : activeTab}</p>
						<p className="text-xs text-muted-foreground">{isTrashView ? t('common.trash') : t('common.active', 'Active')}</p>
					</div>
					<span className="rounded-xl border border-border/70 bg-background/70 p-2 text-primary">
						<Layers className="h-4 w-4" />
					</span>
				</div>
			</div>

			<div className="rounded-2xl border border-border/60 bg-card/65 p-4 shadow-sm backdrop-blur-sm">
				<div className="flex items-start justify-between gap-3">
					<div>
						<p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t('pages.columns.editor')}</p>
						<p className="mt-1 text-sm font-semibold text-foreground">{onlyVisual ? t('pages.badges.visual') : t('pages.form.editor_richtext')}</p>
						<p className="text-xs text-muted-foreground">{onlyVisual ? t('pages.visual_desc') : t('common.manage', 'Manage content')}</p>
					</div>
					<span className="rounded-xl border border-border/70 bg-background/70 p-2 text-primary">
						{onlyVisual ? <Paintbrush className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
					</span>
				</div>
			</div>

			<div className="rounded-2xl border border-border/60 bg-card/65 p-4 shadow-sm backdrop-blur-sm">
				<div className="flex items-start justify-between gap-3">
					<div>
						<p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t('common.mode', 'Mode')}</p>
						<p className="mt-1 text-sm font-semibold text-foreground">{onlyVisual ? t('pages.badges.visual') : t('pages.badges.regular')}</p>
						<p className="text-xs text-muted-foreground">{onlyVisual ? t('common.focus', 'Focused visual editing') : t('common.multi_tab', 'Multi-tab management')}</p>
					</div>
					<span className="rounded-xl border border-primary/25 bg-primary/10 p-2 text-primary">
						<Sparkles className="h-4 w-4" />
					</span>
				</div>
			</div>
		</div>
	);
}

export default PagesOverviewCards;
