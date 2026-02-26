import { Building, CircleCheckBig, Clock3, Globe } from 'lucide-react';

function TenantOverviewCards({ filteredTenants, activeTenantCount, expiringSoonCount }) {
	const uniquePlans = [...new Set(filteredTenants.map((tenant) => tenant.subscription_tier).filter(Boolean))];
	const planMix = uniquePlans.length > 0
		? `${uniquePlans.slice(0, 3).join(' · ')}${uniquePlans.length > 3 ? ` +${uniquePlans.length - 3}` : ''}`
		: 'No plans';
	const suspendedCount = filteredTenants.filter((tenant) => tenant.status === 'suspended').length;

	const cards = [
		{
			title: 'Visible Tenants',
			value: filteredTenants.length,
			description: `${suspendedCount} suspended in current scope`,
			icon: Building,
			iconClassName: 'border-border/70 bg-background/70 text-primary',
		},
		{
			title: 'Active',
			value: activeTenantCount,
			description: 'Operational workspaces',
			icon: CircleCheckBig,
			iconClassName: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
		},
		{
			title: 'Expiring Soon',
			value: expiringSoonCount,
			description: 'Subscription renewals in 30 days',
			icon: Clock3,
			iconClassName: 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300',
		},
		{
			title: 'Plan Mix',
			value: planMix,
			description: 'Active tiers in this view',
			icon: Globe,
			iconClassName: 'border-primary/25 bg-primary/10 text-primary',
		},
	];

	return (
		<div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
			{cards.map((card) => {
				const Icon = card.icon;
				return (
					<div key={card.title} className="rounded-2xl border border-border/60 bg-card/65 p-4 shadow-sm backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
						<div className="flex items-start justify-between gap-3">
							<div>
								<p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{card.title}</p>
								<p className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{card.value}</p>
								<p className="text-xs text-muted-foreground">{card.description}</p>
							</div>
							<span className={`rounded-xl border p-2 ${card.iconClassName}`}>
								<Icon className="h-4 w-4" />
							</span>
						</div>
					</div>
				);
			})}
		</div>
	);
}

export default TenantOverviewCards;
