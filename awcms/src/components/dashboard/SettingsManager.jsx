import GenericContentManager from '@/components/dashboard/GenericContentManager';
import { Settings, SlidersHorizontal, ShieldCheck, Database } from 'lucide-react';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';

function SettingsManager() {
	const columns = [
		{ key: 'key', label: 'Setting Key', className: 'font-mono font-medium' },
		{ key: 'value', label: 'Value', className: 'truncate max-w-[200px]' },
		{
			key: 'scope',
			label: 'Scope',
			className: 'w-[100px]',
			render: (_, row) => (
				<span className={`px-2 py-1 rounded-full text-[10px] font-medium uppercase tracking-wider ${row.scope === 'platform' ? 'bg-primary/10 text-primary' : 'bg-emerald-500/10 text-emerald-500'
					}`}>
					{row.scope || 'tenant'}
				</span>
			)
		},
		{ key: 'description', label: 'Description', className: 'text-muted-foreground text-xs' }
	];

	const formFields = [
		{ key: 'key', label: 'Key', required: true, description: 'Unique identifier (e.g., site_name, maintenance_mode)' },
		{ key: 'value', label: 'Value', type: 'textarea', required: true, description: 'The value for this setting' },
		{ key: 'description', label: 'Description', type: 'textarea', description: 'What this setting controls' },
		{
			key: 'type',
			label: 'Type',
			type: 'select',
			options: [
				{ value: 'string', label: 'String' },
				{ value: 'boolean', label: 'Boolean (true/false)' },
				{ value: 'number', label: 'Number' },
				{ value: 'json', label: 'JSON' }
			]
		}
	];

	const typeCount = formFields.find((field) => field.key === 'type')?.options?.length || 0;

	return (
		<AdminPageLayout requiredPermission="tenant.setting.read">
			<PageHeader
				title="Settings"
				description="Manage system configuration and preferences."
				icon={Settings}
				breadcrumbs={[{ label: 'Settings', icon: Settings }]}
			/>

			<div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
				<div className="rounded-2xl border border-border/60 bg-card/65 p-4 shadow-sm backdrop-blur-sm">
					<div className="flex items-start justify-between gap-3">
						<div>
							<p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Scope</p>
							<p className="mt-1 text-sm font-semibold text-foreground">Tenant Settings</p>
							<p className="text-xs text-muted-foreground">Configurable by tenant access rules</p>
						</div>
						<span className="rounded-xl border border-primary/25 bg-primary/10 p-2 text-primary">
							<ShieldCheck className="h-4 w-4" />
						</span>
					</div>
				</div>

				<div className="rounded-2xl border border-border/60 bg-card/65 p-4 shadow-sm backdrop-blur-sm">
					<div className="flex items-start justify-between gap-3">
						<div>
							<p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Supported Types</p>
							<p className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{typeCount}</p>
							<p className="text-xs text-muted-foreground">String, boolean, number, and JSON</p>
						</div>
						<span className="rounded-xl border border-border/70 bg-background/70 p-2 text-primary">
							<SlidersHorizontal className="h-4 w-4" />
						</span>
					</div>
				</div>

				<div className="rounded-2xl border border-border/60 bg-card/65 p-4 shadow-sm backdrop-blur-sm">
					<div className="flex items-start justify-between gap-3">
						<div>
							<p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Storage</p>
							<p className="mt-1 text-sm font-semibold text-foreground">Table: settings</p>
							<p className="text-xs text-muted-foreground">Central key/value configuration store</p>
						</div>
						<span className="rounded-xl border border-primary/25 bg-primary/10 p-2 text-primary">
							<Database className="h-4 w-4" />
						</span>
					</div>
				</div>

				<div className="rounded-2xl border border-border/60 bg-card/65 p-4 shadow-sm backdrop-blur-sm">
					<div className="flex items-start justify-between gap-3">
						<div>
							<p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Conventions</p>
							<p className="mt-1 text-sm font-semibold text-foreground">snake_case keys</p>
							<p className="text-xs text-muted-foreground">Use stable keys for backward compatibility</p>
						</div>
						<span className="rounded-xl border border-border/70 bg-background/70 p-2 text-primary">
							<Settings className="h-4 w-4" />
						</span>
					</div>
				</div>
			</div>

			<GenericContentManager
				tableName="settings"
				resourceName="Setting"
				columns={columns}
				formFields={formFields}
				permissionPrefix="setting"
				viewPermission="tenant.setting.read"
				createPermission="tenant.setting.create"
				customSelect="*"
				enableSoftDelete={false}
				defaultSortColumn="key"
				defaultFilters={{ scope: 'tenant' }}
				showBreadcrumbs={false}
			/>
		</AdminPageLayout>
	);
}

export default SettingsManager;
