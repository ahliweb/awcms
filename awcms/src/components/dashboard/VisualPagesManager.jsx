import PagesManager from './PagesManager';
import ThemeLayoutManager from './ThemeLayoutManager';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Layers, Palette, ShieldAlert } from 'lucide-react';
import { usePermissions } from '@/contexts/PermissionContext';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';

/**
 * VisualPagesManager
 * Manages both regular visual pages and system theme layouts.
 */
const VisualPagesManager = () => {
    const { hasPermission } = usePermissions();

    if (!hasPermission('tenant.visual_pages.read')) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px] bg-white rounded-xl border border-slate-200 p-12 text-center">
                <div className="p-4 bg-red-50 rounded-full mb-4">
                    <ShieldAlert className="w-12 h-12 text-red-500" />
                </div>
                <h3 className="text-xl font-bold text-slate-800">Access Denied</h3>
                <p className="text-slate-500 mt-2">You do not have permission to view this page.</p>
            </div>
        );
    }

    return (
        <AdminPageLayout requiredPermission="tenant.visual_pages.read">
            <PageHeader
                title="Visual Builder"
                description="Manage your visual pages and system theme templates."
                icon={Layers}
                breadcrumbs={[{ label: 'Visual Pages', icon: Layers }]}
            />

            <Tabs defaultValue="pages" className="w-full">
                <div className="bg-slate-100 dark:bg-slate-800 p-1 rounded-lg inline-flex mb-6">
                    <TabsList className="bg-transparent dark:text-slate-200">
                        <TabsTrigger value="pages" className="flex items-center gap-2 px-4 data-[state=active]:bg-white dark:data-[state=active]:bg-slate-950 dark:data-[state=active]:text-slate-100">
                            <Layers className="w-4 h-4" /> Content Pages
                        </TabsTrigger>
                        <TabsTrigger value="layouts" className="flex items-center gap-2 px-4 data-[state=active]:bg-white dark:data-[state=active]:bg-slate-950 dark:data-[state=active]:text-slate-100">
                            <Palette className="w-4 h-4" /> Theme Layouts
                        </TabsTrigger>
                    </TabsList>
                </div>

                <TabsContent value="pages" className="mt-0">
                    {/* Render regular pages (page_type = regular) */}
                    <PagesManager onlyVisual={true} defaultFilters={{ page_type: 'regular' }} />
                </TabsContent>

                <TabsContent value="layouts" className="mt-0">
                    <ThemeLayoutManager />
                </TabsContent>
            </Tabs>
        </AdminPageLayout>
    );
};

export default VisualPagesManager;
