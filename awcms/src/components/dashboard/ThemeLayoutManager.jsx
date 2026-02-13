
import { useState, useMemo, useCallback } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Layout, Globe, FileType, AlertTriangle, PanelTop, PanelBottom, Pencil } from 'lucide-react';
import GenericContentManager from './GenericContentManager';
import VisualPageBuilder from '@/components/visual-builder/VisualPageBuilder';
import { Button } from '@/components/ui/button';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';

/**
 * ThemeLayoutManager
 * Manages system templates like Homepage, Header, Footer, etc.
 */
const ThemeLayoutManager = () => {
    const [visualBuilderOpen, setVisualBuilderOpen] = useState(false);
    const [selectedPage, setSelectedPage] = useState(null);

    const handleOpenVisualBuilder = useCallback((page) => {
        setSelectedPage(page);
        setVisualBuilderOpen(true);
    }, []);

    const handleCloseVisualBuilder = useCallback(() => {
        setVisualBuilderOpen(false);
        setSelectedPage(null);
    }, []);

    const columns = useMemo(() => [
        { key: 'title', label: 'Template Name', className: 'font-medium' },
        {
            key: 'page_type',
            label: 'Type',
            render: (value) => {
                const labels = {
                    homepage: 'Homepage',
                    header: 'Header',
                    footer: 'Footer',
                    single_page: 'Single Page',
                    single_post: 'Single Post',
                    '404': '404 Error',
                    archive: 'Archive'
                };
                return <span className="font-semibold text-xs uppercase bg-slate-100 dark:bg-slate-800 dark:text-slate-200 px-2 py-1 rounded">{labels[value] || value}</span>
            }
        },
        { key: 'status', label: 'Status' },
        { key: 'updated_at', label: 'Last Updated', type: 'date' }
    ], []);

    const formFields = useMemo(() => [
        { key: 'title', label: 'Template Name', required: true },
        {
            key: 'page_type',
            label: 'Template Type',
            type: 'select',
            options: [
                { value: 'homepage', label: 'Homepage' },
                { value: 'header', label: 'Global Header' },
                { value: 'footer', label: 'Global Footer' },
                { value: 'single_page', label: 'Single Page Template' },
                { value: 'single_post', label: 'Single Post Template' },
                { value: '404', label: '404 Error Page' },
                { value: 'archive', label: 'Archive Template' }
            ],
            required: true
        },
        { key: 'slug', label: 'System Slug', description: 'Unique identifier (e.g. system-header-v1)', required: true },
        { key: 'status', label: 'Status', type: 'select', options: [{ value: 'published', label: 'Active' }, { value: 'draft', label: 'Draft' }] },
        { key: 'editor_type', label: 'Editor', type: 'hidden', defaultValue: 'visual' },
        { key: 'is_active', label: 'Active', type: 'boolean', defaultValue: true }
    ], []);

    // Custom row action to launch Visual Page Builder
    const visualEditorAction = useCallback((item) => (
        <Button
            size="sm"
            variant="outline"
            onClick={() => handleOpenVisualBuilder(item)}
            className="text-purple-600 border-purple-200 hover:bg-purple-50"
            title="Open in Visual Editor"
        >
            <Pencil className="w-4 h-4 mr-1" />
            Visual Editor
        </Button>
    ), [handleOpenVisualBuilder]);

    // Helper to render manager for specific type
    const renderManager = useCallback((type, icon, title) => (
        <GenericContentManager
            tableName="pages"
            resourceName={title}
            columns={columns}
            formFields={formFields.map(f => f.key === 'page_type' ? { ...f, defaultValue: type } : f)}
            permissionPrefix="visual_pages"
            defaultFilters={{ page_type: type, editor_type: 'visual' }}
            customRowActions={visualEditorAction}
            // Custom instructions
            headerContent={
                <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 mb-4 flex items-start gap-2 text-sm text-blue-700">
                    {icon}
                    <div>
                        <strong>Managing {title}</strong>
                        <p className="mt-1 opacity-90">
                            Only the <strong>Published</strong> template of this type will be used by the system.
                            Ensure you have exactly one published item if you want it to be active.
                        </p>
                    </div>
                </div>
            }
        />
    ), [columns, formFields, visualEditorAction]);

    // If Visual Builder is open, render it full-screen
    if (visualBuilderOpen && selectedPage) {
        return (
            <VisualPageBuilder
                page={selectedPage}
                onClose={handleCloseVisualBuilder}
                onSuccess={handleCloseVisualBuilder}
            />
        );
    }

    return (
        <AdminPageLayout requiredPermission="tenant.visual_pages.read">
            <PageHeader
                title="Theme Layouts"
                description="Manage system templates for homepage, header, footer, and more."
                icon={Layout}
                breadcrumbs={[{ label: 'Theme Layouts', icon: Layout }]}
            />

            <Tabs defaultValue="homepage" className="w-full">
                <TabsList className="grid grid-cols-3 lg:grid-cols-6 mb-6 h-auto">
                    <TabsTrigger value="homepage" className="flex flex-col gap-1 py-3"><Globe className="w-4 h-4" /> Homepage</TabsTrigger>
                    <TabsTrigger value="header" className="flex flex-col gap-1 py-3"><PanelTop className="w-4 h-4" /> Header</TabsTrigger>
                    <TabsTrigger value="footer" className="flex flex-col gap-1 py-3"><PanelBottom className="w-4 h-4" /> Footer</TabsTrigger>
                    <TabsTrigger value="single" className="flex flex-col gap-1 py-3"><FileType className="w-4 h-4" /> Singles</TabsTrigger>
                    <TabsTrigger value="404" className="flex flex-col gap-1 py-3"><AlertTriangle className="w-4 h-4" /> 404 Ops</TabsTrigger>
                    <TabsTrigger value="archive" className="flex flex-col gap-1 py-3"><Layout className="w-4 h-4" /> Archive</TabsTrigger>
                </TabsList>

                <TabsContent value="homepage">{renderManager('homepage', <Globe className="w-5 h-5" />, 'Homepage')}</TabsContent>
                <TabsContent value="header">{renderManager('header', <PanelTop className="w-5 h-5" />, 'Global Header')}</TabsContent>
                <TabsContent value="footer">{renderManager('footer', <PanelBottom className="w-5 h-5" />, 'Global Footer')}</TabsContent>

                <TabsContent value="single">
                    <div className="grid gap-8">
                        <div>
                            <h3 className="text-lg font-semibold mb-3 flex items-center gap-2"><FileType className="w-5 h-5" /> Single Page Template</h3>
                            {renderManager('single_page', null, 'Single Page Template')}
                        </div>
                        <div className="border-t pt-6">
                            <h3 className="text-lg font-semibold mb-3 flex items-center gap-2"><FileType className="w-5 h-5" /> Single Post Template</h3>
                            {renderManager('single_post', null, 'Single Post Template')}
                        </div>
                    </div>
                </TabsContent>

                <TabsContent value="404">{renderManager('404', <AlertTriangle className="w-5 h-5" />, '404 Page')}</TabsContent>
                <TabsContent value="archive">{renderManager('archive', <Layout className="w-5 h-5" />, 'Archive Template')}</TabsContent>
            </Tabs>
        </AdminPageLayout>
    );
};

export default ThemeLayoutManager;

