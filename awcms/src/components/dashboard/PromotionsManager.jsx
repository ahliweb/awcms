
import React from 'react';
import GenericContentManager from '@/components/dashboard/GenericContentManager';
import { Tag } from 'lucide-react';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';

function PromotionsManager() {
    const columns = [
        { key: 'title', label: 'Promotion' },
        { key: 'code', label: 'Promo Code' },
        {
            key: 'link',
            label: 'Link',
            render: (value) => value ? <a href={value} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate max-w-[150px] block">{value}</a> : '-'
        },
        {
            key: 'status',
            label: 'Status',
            render: (value) => (
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${value === 'active' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                    value === 'inactive' ? 'bg-muted text-muted-foreground' :
                        value === 'expired' ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400' :
                            'bg-muted text-muted-foreground'
                    }`}>
                    {value || 'inactive'}
                </span>
            )
        }
    ];

    const formFields = [
        { key: 'title', label: 'Title', required: true },
        { key: 'code', label: 'Promo Code', description: 'e.g. WINTER50, SALE2025' },
        { key: 'featured_image', label: 'Banner Image', type: 'image' },
        { key: 'description', label: 'Description', type: 'richtext' },
        { key: 'link', label: 'Redirect URL', type: 'url', description: 'Where to send the user when clicked (https://...)' },
        { key: 'cta_text', label: 'Button Text', description: 'e.g. Shop Now, Learn More' },
        {
            key: 'target',
            label: 'Open In',
            type: 'select',
            options: [{ value: '_self', label: 'Same Tab' }, { value: '_blank', label: 'New Tab' }],
            defaultValue: '_self'
        },
        { key: 'category_id', label: 'Category', type: 'relation', table: 'categories', filter: { type: 'promotion' } },
        { key: 'discount_percentage', label: 'Discount %', type: 'number', description: 'Leave empty if using fixed amount' },
        { key: 'discount_amount', label: 'Discount Amount', type: 'number', description: 'Fixed discount value' },
        { key: 'start_date', label: 'Start Date', type: 'datetime' },
        { key: 'end_date', label: 'End Date', type: 'datetime' },
        {
            key: 'status', label: 'Status', type: 'select', options: [
                { value: 'inactive', label: 'Inactive' },
                { value: 'active', label: 'Active' },
                { value: 'expired', label: 'Expired' }
            ]
        }
    ];

    return (
        <AdminPageLayout requiredPermission="tenant.promotions.read">
            <PageHeader
                title="Promotions"
                description="Manage promotional campaigns and discount codes."
                icon={Tag}
                breadcrumbs={[{ label: 'Promotions', icon: Tag }]}
            />

            <GenericContentManager
                tableName="promotions"
                resourceName="Promotion"
                columns={columns}
                formFields={formFields}
                permissionPrefix="promotions"
                showBreadcrumbs={false}
            />
        </AdminPageLayout>
    );
}

export default PromotionsManager;
