import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Shield, CheckCircle2, FileText, Mail } from 'lucide-react';

const ProfileSummaryCards = ({
	t,
	effectiveRole,
	isPlatformScope,
	permissionCount,
	completedDetailFields,
	primaryEmail,
}) => (
	<div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
		{[
			{
				title: t('profile.summary.current_role', 'Current Role'),
				value: effectiveRole,
				description: isPlatformScope ? t('profile.summary.platform_scope', 'Platform ABAC scope') : t('profile.summary.tenant_scope', 'Tenant ABAC scope'),
				icon: Shield,
				accent: 'from-primary/15 via-primary/6 to-transparent',
				valueClassName: 'text-sm capitalize',
			},
			{
				title: t('profile.summary.permissions', 'Permissions'),
				value: permissionCount,
				description: t('profile.summary.permissions_desc', 'Assigned access keys'),
				icon: CheckCircle2,
				accent: 'from-sky-500/15 via-sky-500/6 to-transparent',
				valueClassName: 'text-2xl',
			},
			{
				title: t('profile.summary.details', 'Profile Details'),
				value: completedDetailFields,
				description: t('profile.summary.details_desc', 'Filled detail fields'),
				icon: FileText,
				accent: 'from-emerald-500/15 via-emerald-500/6 to-transparent',
				valueClassName: 'text-2xl',
			},
			{
				title: t('profile.summary.primary_email', 'Primary Email'),
				value: primaryEmail,
				description: t('profile.summary.primary_email_desc', 'Account login identity'),
				icon: Mail,
				accent: 'from-amber-500/15 via-amber-500/6 to-transparent',
				valueClassName: 'truncate text-sm',
			},
		].map((card) => {
			const Icon = card.icon;

			return (
				<Card key={card.title} className="overflow-hidden rounded-2xl border-border/70 shadow-sm">
					<CardContent className="relative p-5">
						<div className={cn('pointer-events-none absolute inset-0 bg-gradient-to-br', card.accent)} />
						<div className="relative flex items-start justify-between gap-3">
							<div>
								<p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{card.title}</p>
								<p className={cn('mt-3 font-semibold leading-none text-foreground', card.valueClassName)}>{card.value}</p>
								<p className="mt-3 text-xs text-muted-foreground">{card.description}</p>
							</div>
							<span className="rounded-xl border border-border/70 bg-background/70 p-2 text-primary">
								<Icon className="h-4 w-4" />
							</span>
						</div>
					</CardContent>
				</Card>
			);
		})}
	</div>
);

export default ProfileSummaryCards;
