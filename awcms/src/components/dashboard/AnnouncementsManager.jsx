
import React from 'react';
import { Link } from 'react-router-dom';
import GenericContentManager from '@/components/dashboard/GenericContentManager';
import { Megaphone, ChevronRight, Home } from 'lucide-react';

function AnnouncementsManager() {
    const columns = [
        { key: 'title', label: 'Title' },
        {
            key: 'status',
            label: 'Status',
            render: (value) => (
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${value === 'published' ? 'bg-green-100 text-green-700' :
                    value === 'draft' ? 'bg-amber-100 text-amber-700' :
                        value === 'expired' ? 'bg-slate-100 text-slate-600' :
                            'bg-slate-100 text-slate-600'
                    }`}>
                    {value || 'draft'}
                </span>
            )
        },
        {
            key: 'priority',
            label: 'Priority',
            render: (value) => (
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${value === 'urgent' ? 'bg-red-100 text-red-700' :
                    value === 'high' ? 'bg-orange-100 text-orange-700' :
                        'bg-blue-100 text-blue-700'
                    }`}>
                    {value || 'normal'}
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
        { key: 'title', label: 'Title', required: true },
        { key: 'content', label: 'Content', type: 'richtext', required: true },
        { key: 'category_id', label: 'Category', type: 'relation', table: 'categories', filter: { type: 'announcement' } },
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
        <div className="space-y-6">
            {/* Breadcrumb Navigation */}
            <nav className="flex items-center text-sm text-slate-500">
                <Link to="/cmspanel" className="hover:text-blue-600 transition-colors flex items-center gap-1">
                    <Home className="w-4 h-4" />
                    Dashboard
                </Link>
                <ChevronRight className="w-4 h-4 mx-2 text-slate-300" />
                <span className="flex items-center gap-1 text-slate-700 font-medium">
                    <Megaphone className="w-4 h-4" />
                    Announcements
                </span>
            </nav>

            <GenericContentManager
                tableName="announcements"
                resourceName="Announcement"
                columns={columns}
                formFields={formFields}
                permissionPrefix="announcements"
                showBreadcrumbs={false}
            />
        </div>
    );
}

export default AnnouncementsManager;
