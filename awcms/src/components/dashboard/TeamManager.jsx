
import React from 'react';
import GenericContentManager from '@/components/dashboard/GenericContentManager';
import { Users } from 'lucide-react';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';

function TeamManager() {
    const columns = [
        {
            key: 'image',
            label: 'Photo',
            render: (value) => value ? <img src={value} alt="Team" className="w-8 h-8 rounded-full object-cover" /> : <div className="w-8 h-8 rounded-full bg-slate-200"></div>
        },
        { key: 'name', label: 'Name' },
        { key: 'role', label: 'Role' },
        { key: 'order', label: 'Order', type: 'number' },
        {
            key: 'status',
            label: 'Status',
            render: (value) => (
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${value === 'published' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                    value === 'draft' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                        'bg-muted text-muted-foreground'
                    }`}>
                    {value || 'draft'}
                </span>
            )
        }
    ];

    const formFields = [
        { key: 'name', label: 'Full Name', required: true },
        { key: 'role', label: 'Job Role/Position', required: true },
        { key: 'image', label: 'Profile Photo', type: 'image' },
        {
            key: 'social_links',
            label: 'Social Links',
            type: 'json',
            description: 'Array of objects: [{"icon": "ti-facebook", "link": "https://..."}]',
            defaultValue: '[]'
        },
        { key: 'order', label: 'Sort Order', type: 'number', defaultValue: 0 },
        {
            key: 'status',
            label: 'Status',
            type: 'select',
            options: [
                { value: 'draft', label: 'Draft' },
                { value: 'published', label: 'Published' },
                { value: 'archived', label: 'Archived' }
            ]
        }
    ];

    return (
        <AdminPageLayout requiredPermission="tenant.teams.read">
            <PageHeader
                title="Team"
                description="Manage your team members and their profiles."
                icon={Users}
                breadcrumbs={[{ label: 'Team', icon: Users }]}
            />

            <GenericContentManager
                tableName="teams"
                resourceName="Team Member"
                columns={columns}
                formFields={formFields}
                permissionPrefix="teams"
                showBreadcrumbs={false}
                defaultSortColumn="order"
            />
        </AdminPageLayout>
    );
}

export default TeamManager;
