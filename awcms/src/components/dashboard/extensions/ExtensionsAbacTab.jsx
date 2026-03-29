import { Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ExtensionABACIntegration from '@/components/dashboard/ExtensionABACIntegration';

function ExtensionsAbacTab({
	t,
	selectedForABAC,
	onBack,
}) {
	if (selectedForABAC) {
		return (
			<div className="space-y-4">
				<Button
					variant="outline"
					onClick={onBack}
					className="mb-4 rounded-xl border-border/70 bg-background/80 text-muted-foreground hover:bg-accent/70 hover:text-foreground"
				>
					{t('common.back')}
				</Button>
				<h3 className="text-xl font-bold text-foreground">{t('extensions.managing_abac_for', { name: selectedForABAC.name })}</h3>
				<p className="text-sm text-muted-foreground">{t('extensions.abac_scope_hint')}</p>
				<ExtensionABACIntegration extensionId={selectedForABAC.id} extension={selectedForABAC} />
			</div>
		);
	}

	return (
		<div className="rounded-2xl border border-dashed border-border/70 bg-card/55 py-12 text-center">
			<Shield className="mx-auto mb-3 h-12 w-12 text-muted-foreground" />
			<h3 className="text-lg font-medium text-foreground">{t('extensions.select_extension')}</h3>
			<p className="text-muted-foreground">{t('extensions.select_extension_hint')}</p>
		</div>
	);
}

export default ExtensionsAbacTab;
