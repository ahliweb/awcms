
import { useTranslation } from 'react-i18next';
import GenericContentManager from '@/components/dashboard/GenericContentManager';
import StatusBadge from '@/components/ui/StatusBadge';

function AnnouncementsManager() {
    const { t } = useTranslation();

    const columns = [
        { key: 'title', label: t('announcements.columns.title') },
        {
            key: 'status',
            label: t('announcements.columns.status'),
            render: (value) => <StatusBadge status={value || 'draft'} />
        },
        {
            key: 'priority',
            label: t('announcements.columns.priority'),
            render: (value) => <StatusBadge status={value || 'normal'} />
        },
        {
            key: 'published_at',
            label: t('announcements.columns.publish_date'),
            type: 'date',
            render: (value) => value ? new Date(value).toLocaleDateString() : '-'
        }
    ];

    const formFields = [
        { key: 'title', label: t('announcements.fields.title'), required: true },
        { key: 'content', label: t('announcements.fields.content'), type: 'richtext', required: true },
        { key: 'category_id', label: t('announcements.fields.category'), type: 'relation', table: 'categories', filter: { type: ['announcement', 'announcements'] } },
        {
            key: 'status', label: t('announcements.fields.status'), type: 'select', options: [
                { value: 'draft', label: t('announcements.status.draft') },
                { value: 'published', label: t('announcements.status.published') },
                { value: 'expired', label: t('announcements.status.expired') }
            ]
        },
        {
            key: 'priority', label: t('announcements.fields.priority'), type: 'select', options: [
                { value: 'normal', label: t('announcements.priority.normal') },
                { value: 'high', label: t('announcements.priority.high') },
                { value: 'urgent', label: t('announcements.priority.urgent') }
            ]
        },
        { key: 'published_at', label: t('announcements.fields.publish_date'), type: 'datetime' },
        { key: 'expires_at', label: t('announcements.fields.expires_at'), type: 'datetime' }
    ];

    return (
        <GenericContentManager
            tableName="announcements"
            resourceName="Announcement"
            columns={columns}
            formFields={formFields}
            permissionPrefix="announcements"
        />
    );
}

export default AnnouncementsManager;
