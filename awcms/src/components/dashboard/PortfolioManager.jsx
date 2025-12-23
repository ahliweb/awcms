
import React from 'react';
import { Link } from 'react-router-dom';
import GenericContentManager from '@/components/dashboard/GenericContentManager';
import { Briefcase, ChevronRight, Home } from 'lucide-react';

function PortfolioManager() {
    const columns = [
        { key: 'title', label: 'Project' },
        { key: 'client', label: 'Client' },
        { key: 'project_date', label: 'Date', type: 'date' },
        {
            key: 'status',
            label: 'Status',
            render: (value) => (
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${value === 'published' ? 'bg-green-100 text-green-700' :
                    value === 'draft' ? 'bg-amber-100 text-amber-700' :
                        'bg-slate-100 text-slate-600'
                    }`}>
                    {value || 'draft'}
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
        { key: 'title', label: 'Project Title', required: true },
        { key: 'slug', label: 'URL Slug', placeholder: 'auto-generated-from-title' },
        { key: 'featured_image', label: 'Cover Image', type: 'image', description: 'Main project thumbnail' },
        { key: 'client', label: 'Client Name' },
        { key: 'description', label: 'Description', type: 'richtext' },
        { key: 'project_date', label: 'Project Date', type: 'date' },
        { key: 'category_id', label: 'Category', type: 'relation', table: 'categories', filter: { type: 'portfolio' } },
        { key: 'published_at', label: 'Publish Date', type: 'datetime' },
        {
            key: 'status',
            label: 'Status',
            type: 'select',
            options: [
                { value: 'draft', label: 'Draft' },
                { value: 'published', label: 'Published' },
                { value: 'archived', label: 'Archived' }
            ]
        },
        { key: 'images', label: 'Project Gallery', type: 'images', maxImages: 20, description: 'Add multiple project images' }
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
                    <Briefcase className="w-4 h-4" />
                    Portfolio
                </span>
            </nav>

            <GenericContentManager
                tableName="portfolio"
                resourceName="Portfolio Project"
                columns={columns}
                formFields={formFields}
                permissionPrefix="portfolio"
                showBreadcrumbs={false}
            />
        </div>
    );
}

export default PortfolioManager;
