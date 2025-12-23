
import React from 'react';
import { Link } from 'react-router-dom';
import GenericContentManager from '@/components/dashboard/GenericContentManager';
import { Video, ChevronRight, Home } from 'lucide-react';

function VideoGalleryManager() {
    const columns = [
        { key: 'title', label: 'Title' },
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
        { key: 'title', label: 'Title', required: true },
        { key: 'slug', label: 'Slug', description: 'URL-friendly name (auto-generated if empty)' },
        { key: 'youtube_playlist_url', label: 'YouTube Video URL', description: 'Link to the video on YouTube' },
        { key: 'thumbnail_image', label: 'Custom Thumbnail', type: 'image', description: 'Optional custom cover image' },
        { key: 'description', label: 'Description', type: 'richtext' },
        { key: 'category_id', label: 'Category', type: 'relation', table: 'categories', filter: { type: 'video_gallery' } },
        { key: 'published_at', label: 'Publish Date', type: 'datetime', description: 'Schedule for future release (optional)' },
        {
            key: 'status', label: 'Status', type: 'select', options: [
                { value: 'draft', label: 'Draft' },
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
                    <Video className="w-4 h-4" />
                    Video Gallery
                </span>
            </nav>

            <GenericContentManager
                tableName="video_gallery"
                resourceName="Video Gallery"
                columns={columns}
                formFields={formFields}
                permissionPrefix="video_gallery"
                showBreadcrumbs={false}
            />
        </div>
    );
}

export default VideoGalleryManager;
