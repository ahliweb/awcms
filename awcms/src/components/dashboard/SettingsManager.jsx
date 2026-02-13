import GenericContentManager from '@/components/dashboard/GenericContentManager';
import { Settings } from 'lucide-react';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';

function SettingsManager() {
    const columns = [
        { key: 'key', label: 'Setting Key', className: 'font-mono font-medium' },
        { key: 'value', label: 'Value', className: 'truncate max-w-[200px]' },
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

    return (
        <AdminPageLayout requiredPermission="tenant.setting.read">
            <PageHeader
                title="Settings"
                description="Manage system configuration and preferences."
                icon={Settings}
                breadcrumbs={[{ label: 'Settings', icon: Settings }]}
            />

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
                showBreadcrumbs={false}
            />
        </AdminPageLayout>
    );
}

export default SettingsManager;
