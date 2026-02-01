
import React from 'react';
import GenericContentManager from '@/components/dashboard/GenericContentManager';
import { Star, MessageSquareQuote } from 'lucide-react';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';

function TestimonyManager() {
    const columns = [
        { key: 'author_name', label: 'Author' },
        { key: 'title', label: 'Title' },
        { key: 'category_id', label: 'Category', type: 'relation', relationTable: 'categories', relationLabel: 'name' },
        {
            key: 'rating',
            label: 'Rating',
            render: (value) => (
                <div className="flex text-yellow-500 dark:text-yellow-400">
                    {[...Array(5)].map((_, i) => (
                        <Star key={i} className={`w-3 h-3 ${i < (value || 0) ? 'fill-current' : 'text-muted/30'}`} />
                    ))}
                </div>
            )
        },
        {
            key: 'status',
            label: 'Status',
            render: (value) => (
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${value === 'published' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                    value === 'pending' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                        'bg-muted text-muted-foreground'
                    }`}>
                    {value || 'pending'}
                </span>
            )
        },
        {
            key: 'published_at',
            label: 'Publish Date',
            type: 'date',
            render: (value) => value ? new Date(value).toLocaleDateString() : '-'
        }
    ];

    const formFields = [
        { key: 'title', label: 'Title/Headline', required: true, description: 'E.g. "Great Service!"' },
        { key: 'slug', label: 'Slug', required: false, description: 'Auto-generated if empty' },
        { key: 'author_name', label: 'Author Name', required: true },
        { key: 'author_position', label: 'Position/Company' },
        { key: 'author_image', label: 'Author Photo', type: 'image', description: 'Upload or select from Media Library' },
        { key: 'content', label: 'Testimony', type: 'richtext', required: true },
        { key: 'category_id', label: 'Category', type: 'resource_select', resourceTable: 'categories', filter: { type: 'testimony' } },
        { key: 'rating', label: 'Rating (1-5)', type: 'number', required: true },
        { key: 'published_at', label: 'Publish Date', type: 'datetime' },
        {
            key: 'status', label: 'Status', type: 'select', options: [
                { value: 'pending', label: 'Pending' },
                { value: 'published', label: 'Published' }
            ]
        }
    ];

    return (
        <AdminPageLayout requiredPermission="tenant.testimonies.read">
            <PageHeader
                title="Testimonies"
                description="Manage customer reviews and testimonials."
                icon={MessageSquareQuote}
                breadcrumbs={[{ label: 'Testimonies', icon: MessageSquareQuote }]}
            />

            <GenericContentManager
                tableName="testimonials"
                resourceName="Testimony"
                columns={columns}
                formFields={formFields}
                permissionPrefix="testimonials"
                showBreadcrumbs={false}
            />
        </AdminPageLayout>
    );
}

export default TestimonyManager;
