
import React from 'react';
import { Link } from 'react-router-dom';
import GenericContentManager from '@/components/dashboard/GenericContentManager';
import { Mail, ChevronRight, Home } from 'lucide-react';

function ContactMessagesManager() {
    const columns = [
        { key: 'name', label: 'Sender' },
        { key: 'subject', label: 'Subject' },
        { key: 'created_at', label: 'Date', type: 'date' },
        { key: 'status', label: 'Status' }
    ];

    const formFields = [
        { key: 'status', label: 'Status', type: 'select', options: [{ value: 'new', label: 'New' }, { value: 'read', label: 'Read' }, { value: 'replied', label: 'Replied' }] }
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
                    <Mail className="w-4 h-4" />
                    Contact Messages
                </span>
            </nav>

            <GenericContentManager
                tableName="contact_messages"
                resourceName="Message"
                columns={columns}
                formFields={formFields}
                permissionPrefix="contact_messages"
                showBreadcrumbs={false}
            />
        </div>
    );
}

export default ContactMessagesManager;
