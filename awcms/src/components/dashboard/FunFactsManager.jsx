
import React from 'react';
import GenericContentManager from '@/components/dashboard/GenericContentManager';
import { Trophy } from 'lucide-react';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';

function FunFactsManager() {
    const columns = [
        { key: 'title', label: 'Title' },
        { key: 'count', label: 'Count' },
        {
            key: 'icon',
            label: 'Icon',
            render: (value) => value ? <i className={value}></i> : '-'
        },
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
        { key: 'title', label: 'Title', required: true },
        { key: 'count', label: 'Count Display (e.g. 500+)', required: true },
        { key: 'icon', label: 'Icon Class (e.g. ti-user)', description: 'Themify icon class' },
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
        <AdminPageLayout requiredPermission="tenant.funfacts.read">
            <PageHeader
                title="Fun Facts"
                description="Manage statistics and key numbers displayed on your site."
                icon={Trophy}
                breadcrumbs={[{ label: 'Fun Facts', icon: Trophy }]}
            />

            <GenericContentManager
                tableName="funfacts"
                resourceName="Fun Fact"
                columns={columns}
                formFields={formFields}
                permissionPrefix="funfacts"
                showBreadcrumbs={false}
                defaultSortColumn="order"
            />
        </AdminPageLayout>
    );
}

export default FunFactsManager;
