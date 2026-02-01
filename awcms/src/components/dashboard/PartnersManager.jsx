
import React from 'react';
import GenericContentManager from '@/components/dashboard/GenericContentManager';
import { Handshake } from 'lucide-react';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';

function PartnersManager() {
    const columns = [
        {
            key: 'logo',
            label: 'Logo',
            render: (value) => value ? <img src={value} alt="Partner" className="h-8 object-contain" /> : '-'
        },
        { key: 'name', label: 'Name' },
        { key: 'link', label: 'Website' },
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
        { key: 'name', label: 'Partner Name', required: true },
        { key: 'logo', label: 'Logo Image', type: 'image', required: true },
        { key: 'link', label: 'Website URL' },
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
        <AdminPageLayout requiredPermission="tenant.partners.read">
            <PageHeader
                title="Partners"
                description="Manage partner logos and sponsorships."
                icon={Handshake}
                breadcrumbs={[{ label: 'Partners', icon: Handshake }]}
            />

            <GenericContentManager
                tableName="partners"
                resourceName="Partner"
                columns={columns}
                formFields={formFields}
                permissionPrefix="partners"
                showBreadcrumbs={false}
                defaultSortColumn="order"
            />
        </AdminPageLayout>
    );
}

export default PartnersManager;
