import { Building2, ChevronRight, CloudCog, Database, Home, Layers3, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AdminPageLayout } from '@/templates/flowbite-admin';
import { usePermissions } from '@/contexts/PermissionContext';
import { useTenant } from '@/contexts/TenantContext';
import DashboardModuleIntro from '@/components/dashboard/DashboardModuleIntro';

function PlatformDiagnostics() {
	const { t } = useTranslation();
  const { role, tenantId, isPlatformAdmin, isFullAccess } = usePermissions();
  const { currentTenant, resolvedTenant, platformTenantScopeId } = useTenant();
	const summaryCards = [
		{
			title: t('diagnostics.summary.access', 'Access Scope'),
			value: isPlatformAdmin || isFullAccess ? t('common.global', 'Global') : t('diagnostics.summary.tenant', 'Tenant'),
			description: t('diagnostics.summary.access_desc', 'Current ABAC authority resolved for the active admin session.'),
			accent: 'from-primary/15 via-primary/6 to-transparent',
		},
		{
			title: t('diagnostics.summary.tenant_scope', 'Tenant Scope'),
			value: currentTenant?.name || resolvedTenant?.name || t('diagnostics.none', 'None'),
			description: t('diagnostics.summary.tenant_scope_desc', 'Resolved tenant context used for scoped queries and admin views.'),
			accent: 'from-sky-500/15 via-sky-500/6 to-transparent',
		},
		{
			title: t('diagnostics.summary.runtime', 'Runtime'),
			value: 'Cloudflare',
			description: t('diagnostics.summary.runtime_desc', 'Edge and storage guarantees currently enforced by the platform stack.'),
			accent: 'from-emerald-500/15 via-emerald-500/6 to-transparent',
		},
	];

  return (
		<AdminPageLayout requiredPermission="platform.tenant.read" unwrapped>
			<nav>
				<ol className="flex flex-wrap items-center gap-1.5 break-words text-sm text-muted-foreground sm:gap-2.5">
					<li className="inline-flex items-center gap-1.5">
						<Link to="/cmspanel" className="flex items-center gap-1 transition-colors hover:text-foreground">
							<Home className="h-4 w-4" />
							{t('menu.dashboard', 'Dashboard')}
						</Link>
					</li>
					<li aria-hidden="true" className="[&>svg]:size-3.5"><ChevronRight /></li>
					<li className="inline-flex items-center gap-1.5">
						<div className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 font-medium text-primary-foreground shadow-sm">
							<CloudCog className="h-3.5 w-3.5" />
							<span>{t('diagnostics.title', 'Platform Diagnostics')}</span>
						</div>
					</li>
				</ol>
			</nav>

			<DashboardModuleIntro
				icon={CloudCog}
				eyebrow={t('diagnostics.eyebrow', 'Diagnostics')}
				title={t('diagnostics.title', 'Platform Diagnostics')}
				description={t('diagnostics.subtitle', 'Inspect active platform scope, tenant scope, and runtime guarantees across the centralized admin system.')}
				badges={[
					{ icon: Layers3, iconClassName: 'text-primary', label: t('diagnostics.route_shell', 'Refresh-safe `/cmspanel/platform/diagnostics` route shell') },
					{ icon: ShieldCheck, iconClassName: 'text-emerald-600', label: t('diagnostics.badge_desc', 'Platform ABAC diagnostics with tenant context verification') },
				]}
				summaryCards={summaryCards}
			/>

			<div className="grid gap-6 text-sm lg:grid-cols-3">
				<div className="rounded-2xl border border-border/60 bg-card/65 p-6 shadow-sm backdrop-blur-sm">
					<div className="mb-4 flex items-center gap-2 font-semibold text-foreground">
						<ShieldCheck className="h-4 w-4 text-primary" />
						{t('diagnostics.sections.scope_access', 'Scope & Access')}
					</div>
					<div className="space-y-3 text-muted-foreground">
						<div className="flex justify-between gap-4"><span>{t('diagnostics.fields.active_role', 'Active role')}</span><span className="font-medium text-foreground">{role?.name || t('diagnostics.unknown', 'Unknown')}</span></div>
						<div className="flex justify-between gap-4"><span>{t('diagnostics.fields.role_scope', 'Role scope')}</span><span className="font-medium text-foreground">{role?.scope || 'tenant'}</span></div>
						<div className="flex justify-between gap-4"><span>{t('diagnostics.fields.platform_access', 'Platform access')}</span><span className="font-medium text-foreground">{isPlatformAdmin || isFullAccess ? t('diagnostics.full', 'Full') : t('diagnostics.summary.tenant', 'Tenant')}</span></div>
					</div>
				</div>

				<div className="rounded-2xl border border-border/60 bg-card/65 p-6 shadow-sm backdrop-blur-sm">
					<div className="mb-4 flex items-center gap-2 font-semibold text-foreground">
						<Building2 className="h-4 w-4 text-primary" />
						{t('diagnostics.sections.tenant_scope', 'Tenant Scope')}
					</div>
					<div className="space-y-3 text-muted-foreground">
						<div className="flex justify-between gap-4"><span>{t('diagnostics.fields.resolved_tenant', 'Resolved tenant')}</span><span className="font-medium text-foreground">{resolvedTenant?.name || t('diagnostics.none', 'None')}</span></div>
						<div className="flex justify-between gap-4"><span>{t('diagnostics.fields.active_scope', 'Active scope')}</span><span className="font-medium text-foreground">{currentTenant?.name || t('diagnostics.none', 'None')}</span></div>
						<div className="flex justify-between gap-4"><span>{t('diagnostics.fields.scoped_override', 'Scoped override')}</span><span className="font-medium text-foreground">{platformTenantScopeId && platformTenantScopeId !== resolvedTenant?.id ? t('diagnostics.enabled', 'Enabled') : t('diagnostics.default', 'Default')}</span></div>
						<div className="flex justify-between gap-4"><span>{t('diagnostics.fields.rls_tenant_id', 'RLS tenant id')}</span><span className="font-medium text-foreground">{currentTenant?.id || tenantId || t('diagnostics.none', 'None')}</span></div>
					</div>
				</div>

				<div className="rounded-2xl border border-border/60 bg-card/65 p-6 shadow-sm backdrop-blur-sm">
					<div className="mb-4 flex items-center gap-2 font-semibold text-foreground">
						<Database className="h-4 w-4 text-primary" />
						{t('diagnostics.sections.storage_edge', 'Storage & Edge')}
					</div>
					<div className="space-y-3 text-muted-foreground">
						<div className="flex justify-between gap-4"><span>{t('diagnostics.fields.object_storage', 'Object storage')}</span><span className="font-medium text-foreground">Cloudflare R2</span></div>
						<div className="flex justify-between gap-4"><span>{t('diagnostics.fields.function_runtime', 'Function runtime')}</span><span className="font-medium text-foreground">Cloudflare Edge</span></div>
						<div className="flex justify-between gap-4"><span>{t('diagnostics.fields.supabase_storage', 'Supabase Storage')}</span><span className="font-medium text-foreground">{t('diagnostics.blocked', 'Blocked')}</span></div>
						<div className="flex justify-between gap-4"><span>{t('diagnostics.fields.supabase_edge', 'Supabase Edge Functions')}</span><span className="font-medium text-foreground">{t('diagnostics.disabled', 'Disabled')}</span></div>
					</div>
				</div>
			</div>
		</AdminPageLayout>
  );
}

export default PlatformDiagnostics;
