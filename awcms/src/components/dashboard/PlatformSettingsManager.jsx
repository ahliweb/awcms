import React from 'react';
import GenericContentManager from '@/components/dashboard/GenericContentManager';
import { Settings, SlidersHorizontal, ShieldCheck, Database, Globe } from 'lucide-react';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';

function PlatformSettingsManager() {
    const columns = [
        { key: 'key', label: 'Setting Key', className: 'font-mono font-medium' },
        { key: 'value', label: 'Value', className: 'truncate max-w-[200px]' },
        { key: 'category', label: 'Category', className: 'text-xs uppercase bg-primary/10 text-primary px-2 py-1 flex items-center justify-center rounded-full' },
        { key: 'is_overridable', label: 'Overridable', className: 'text-xs' },
        { key: 'description', label: 'Description', className: 'text-muted-foreground text-xs' }
    ];

    const formFields = [
        { key: 'key', label: 'Key', required: true, description: 'Unique identifier (e.g., maintenance_mode, platform_name)' },
        { key: 'value', label: 'Value', type: 'textarea', required: true, description: 'The global platform value for this setting' },
        { key: 'description', label: 'Description', type: 'textarea', description: 'What this setting controls globally' },
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
        },
        {
            key: 'category',
            label: 'Category',
            type: 'select',
            defaultValue: 'general',
            options: [
                { value: 'general', label: 'General' },
                { value: 'security', label: 'Security' },
                { value: 'features', label: 'Features' },
                { value: 'limits', label: 'Limits' }
            ]
        },
        { key: 'is_overridable', label: 'Allow Tenants to Override', type: 'boolean', defaultValue: true, description: 'If true, Tenant Admins can set their own value for this key in their Settings.' }
    ];

    return (
        <AdminPageLayout requiredPermission="platform.setting.read">
            <PageHeader
                title="Platform Settings"
                description="Manage global defaults and platform-wide configurations. These settings serve as defaults unless overridden by a tenant."
                icon={Globe}
                breadcrumbs={[{ label: 'Platform Settings', icon: Globe }]}
            />

            <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-border/60 bg-card/65 p-4 shadow-sm backdrop-blur-sm">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Scope</p>
                            <p className="mt-1 text-sm font-semibold text-foreground">Platform Defaults</p>
                            <p className="text-xs text-muted-foreground">Applies globally across all tenants</p>
                        </div>
                        <span className="rounded-xl border border-primary/25 bg-primary/10 p-2 text-primary">
                            <ShieldCheck className="h-4 w-4" />
                        </span>
                    </div>
                </div>

                <div className="rounded-2xl border border-border/60 bg-card/65 p-4 shadow-sm backdrop-blur-sm">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Overrides</p>
                            <p className="mt-1 text-sm font-semibold text-foreground">Cascading Values</p>
                            <p className="text-xs text-muted-foreground">Tenant overrides platform default seamlessly</p>
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
                            <p className="mt-1 text-sm font-semibold text-foreground">Table: platform_settings</p>
                            <p className="text-xs text-muted-foreground">Global configuration distinct from tenants</p>
                        </div>
                        <span className="rounded-xl border border-primary/25 bg-primary/10 p-2 text-primary">
                            <Database className="h-4 w-4" />
                        </span>
                    </div>
                </div>

                <div className="rounded-2xl border border-border/60 bg-card/65 p-4 shadow-sm backdrop-blur-sm">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Global Only</p>
                            <p className="mt-1 text-sm font-semibold text-foreground">Platform Admins</p>
                            <p className="text-xs text-muted-foreground">Strict RLS prevents any tenant access</p>
                        </div>
                        <span className="rounded-xl border border-border/70 bg-background/70 p-2 text-primary">
                            <Globe className="h-4 w-4" />
                        </span>
                    </div>
                </div>
            </div>

            <GenericContentManager
                tableName="platform_settings"
                resourceName="Platform Setting"
                columns={columns}
                formFields={formFields}
                // Use full ABAC strings for custom validation
                viewPermission="platform.setting.read"
                createPermission="platform.setting.create"
                updatePermission="platform.setting.update"
                deletePermission="platform.setting.delete"
                customSelect="*"
                enableSoftDelete={false}
                defaultSortColumn="key"
                showBreadcrumbs={false}
                disableTenantFilter={true} // Override tenant-filtering as this table lacks tenant_id
            />
        </AdminPageLayout>
    );
}

export default PlatformSettingsManager;
