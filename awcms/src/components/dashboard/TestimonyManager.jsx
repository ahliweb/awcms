
import React from 'react';
import { Link } from 'react-router-dom';
import GenericContentManager from '@/components/dashboard/GenericContentManager';
import { Star, MessageSquareQuote, ChevronRight, Home } from 'lucide-react';

function TestimonyManager() {
    const columns = [
        { key: 'author_name', label: 'Author' },
        { key: 'title', label: 'Title' },
        { key: 'category_id', label: 'Category', type: 'relation', relationTable: 'categories', relationLabel: 'name' },
        {
            key: 'rating',
            label: 'Rating',
            render: (value) => (
                <div className="flex text-yellow-400">
                    {[...Array(5)].map((_, i) => (
                        <Star key={i} className={`w-3 h-3 ${i < (value || 0) ? 'fill-current' : 'text-slate-200'}`} />
                    ))}
                </div>
            )
        },
        {
            key: 'status',
            label: 'Status',
            render: (value) => (
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${value === 'published' ? 'bg-green-100 text-green-700' :
                    value === 'pending' ? 'bg-amber-100 text-amber-700' :
                        'bg-slate-100 text-slate-600'
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
        <div className="space-y-6">
            {/* Breadcrumb Navigation */}
            <nav className="flex items-center text-sm text-slate-500">
                <Link to="/cmspanel" className="hover:text-blue-600 transition-colors flex items-center gap-1">
                    <Home className="w-4 h-4" />
                    Dashboard
                </Link>
                <ChevronRight className="w-4 h-4 mx-2 text-slate-300" />
                <span className="flex items-center gap-1 text-slate-700 font-medium">
                    <MessageSquareQuote className="w-4 h-4" />
                    Testimonies
                </span>
            </nav>

            <GenericContentManager
                tableName="testimonies"
                resourceName="Testimony"
                columns={columns}
                formFields={formFields}
                permissionPrefix="testimonies"
                showBreadcrumbs={false}
            />
        </div>
    );
}

export default TestimonyManager;
