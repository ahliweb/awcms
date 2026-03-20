
import GenericContentManager from '@/components/dashboard/GenericContentManager';
import StatusBadge from '@/components/ui/StatusBadge';
import { Megaphone } from 'lucide-react';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';

function AnnouncementsManager() {
    const columns = [
        { key: 'title', label: 'Title' },
        {
            key: 'status',
            label: 'Status',
            render: (value) => <StatusBadge status={value || 'draft'} />
        },
        {
            key: 'priority',
            label: 'Priority',
            render: (value) => <StatusBadge status={value || 'normal'} />
        },
        {
            key: 'published_at',
            label: 'Publish Date',
            type: 'date',
            render: (value) => value ? new Date(value).toLocaleDateString() : '-'
        }
    ];

    const formFields = [
        { key: 'title', label: 'Title', required: true },
        { key: 'content', label: 'Content', type: 'richtext', required: true },
        { key: 'category_id', label: 'Category', type: 'relation', table: 'categories', filter: { type: ['announcement', 'announcements'] } },
        {
            key: 'status', label: 'Status', type: 'select', options: [
                { value: 'draft', label: 'Draft' },
                { value: 'published', label: 'Published' },
                { value: 'expired', label: 'Expired' }
            ]
        },
        {
            key: 'priority', label: 'Priority', type: 'select', options: [
                { value: 'normal', label: 'Normal' },
                { value: 'high', label: 'High' },
                { value: 'urgent', label: 'Urgent' }
            ]
        },
        { key: 'published_at', label: 'Publish Date', type: 'datetime' },
        { key: 'expires_at', label: 'Expires At', type: 'datetime' }
    ];

    return (
        <AdminPageLayout requiredPermission="tenant.announcements.read">
            <PageHeader
                title="Announcements"
                description="Create and manage system-wide announcements."
                icon={Megaphone}
                breadcrumbs={[{ label: 'Announcements', icon: Megaphone }]}
            />

            <GenericContentManager
                tableName="announcements"
                resourceName="Announcement"
                columns={columns}
                formFields={formFields}
                permissionPrefix="announcements"
                showBreadcrumbs={false}
                showHeader={false}
            />
        </AdminPageLayout>
    );
}

export default AnnouncementsManager;
