
import React from 'react';
import GenericContentManager from '@/components/dashboard/GenericContentManager';
import { Mail } from 'lucide-react';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';

function ContactMessagesManager() {
    const columns = [
        { key: 'name', label: 'Sender' },
        { key: 'subject', label: 'Subject' },
        { key: 'created_at', label: 'Date', type: 'date' },
        { key: 'ip_address', label: 'IP Address' },
        {
            key: 'status',
            label: 'Status',
            render: (value) => (
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${value === 'new' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
                    value === 'replied' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                        'bg-muted text-muted-foreground'
                    }`}>
                    {value || 'new'}
                </span>
            )
        }
    ];

    const formFields = [
        { key: 'name', label: 'Name', type: 'text', required: true },
        { key: 'email', label: 'Email', type: 'email', required: true },
        { key: 'subject', label: 'Subject', type: 'text', required: true },
        { key: 'message', label: 'Message', type: 'textarea', required: true, rows: 4 },
        { key: 'status', label: 'Status', type: 'select', options: [{ value: 'new', label: 'New' }, { value: 'read', label: 'Read' }, { value: 'replied', label: 'Replied' }] }
    ];

    return (
        <AdminPageLayout requiredPermission="tenant.contact_messages.read">
            <PageHeader
                title="Contact Messages"
                description="View and manage incoming contact form submissions."
                icon={Mail}
                breadcrumbs={[{ label: 'Messages', icon: Mail }]}
            />

            <GenericContentManager
                tableName="contact_messages"
                resourceName="Message"
                columns={columns}
                formFields={formFields}
                permissionPrefix="contact_messages"
                showBreadcrumbs={false}
            />
        </AdminPageLayout>
    );
}

export default ContactMessagesManager;
