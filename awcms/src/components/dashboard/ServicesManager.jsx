
import React from 'react';
import GenericContentManager from '@/components/dashboard/GenericContentManager';
import { Wrench } from 'lucide-react';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';

function ServicesManager() {
    const columns = [
        { key: 'title', label: 'Title' },
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
        { key: 'description', label: 'Description', type: 'richtext' },
        { key: 'icon', label: 'Icon Class (e.g., ti-ruler-pencil)', description: 'Use Themify icon class names' },
        { key: 'image', label: 'Service Image', type: 'image' },
        { key: 'link', label: 'Link URL' },
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
        <AdminPageLayout requiredPermission="tenant.services.read">
            <PageHeader
                title="Services"
                description="Manage your company's services showcase."
                icon={Wrench}
                breadcrumbs={[{ label: 'Services', icon: Wrench }]}
            />

            <GenericContentManager
                tableName="services"
                resourceName="Service"
                columns={columns}
                formFields={formFields}
                permissionPrefix="services"
                showBreadcrumbs={false}
                defaultSortColumn="order"
            />
        </AdminPageLayout>
    );
}

export default ServicesManager;
