import PagesManager from './PagesManager';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import ThemeLayoutManager from './ThemeLayoutManager';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Layers, Palette, ShieldAlert } from 'lucide-react';
import { usePermissions } from '@/contexts/PermissionContext';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';
import useSplatSegments from '@/hooks/useSplatSegments';

/**
 * VisualPagesManager
 * Manages both regular visual pages and system theme layouts.
 */
const VisualPagesManager = () => {
    const { t } = useTranslation();
    const { hasPermission } = usePermissions();
    const navigate = useNavigate();
    const segments = useSplatSegments();
    const tabValues = ['pages', 'layouts'];
    const hasTabSegment = tabValues.includes(segments[0]);
    const activeTab = hasTabSegment ? segments[0] : 'pages';
    const hasExtraSegment = segments.length > 1;

    useEffect(() => {
        if (segments.length > 0 && !hasTabSegment) {
            navigate('/cmspanel/visual-pages', { replace: true });
            return;
        }

        if (hasTabSegment && hasExtraSegment) {
            const basePath = activeTab === 'pages' ? '/cmspanel/visual-pages' : `/cmspanel/visual-pages/${activeTab}`;
            navigate(basePath, { replace: true });
        }
    }, [segments, hasTabSegment, hasExtraSegment, activeTab, navigate]);

    if (!hasPermission('tenant.visual_pages.read')) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px] bg-card rounded-xl border border-border p-12 text-center">
                <div className="p-4 bg-destructive/10 rounded-full mb-4">
                    <ShieldAlert className="w-12 h-12 text-destructive" />
                </div>
                <h3 className="text-xl font-bold text-foreground">{t('common.access_denied')}</h3>
                <p className="text-muted-foreground mt-2">{t('common.permission_required')}</p>
            </div>
        );
    }

    return (
        <AdminPageLayout requiredPermission="tenant.visual_pages.read" className="space-y-6">
            <PageHeader
                title={t('pages.visual_builder')}
                description="Manage visual page compositions and shared page/blog templates from one editor surface."
                icon={Layers}
                breadcrumbs={[{ label: t('pages.visual_title'), icon: Layers }]}
            />

            <Tabs
                value={activeTab}
                onValueChange={(value) => {
                    navigate(value === 'pages' ? '/cmspanel/visual-pages' : `/cmspanel/visual-pages/${value}`);
                }}
                className="w-full"
            >
                <div className="bg-muted p-1 rounded-lg inline-flex mb-6">
                    <TabsList className="bg-transparent">
                        <TabsTrigger value="pages" className="flex items-center gap-2 px-4 data-[state=active]:bg-card data-[state=active]:text-foreground">
                            <Layers className="w-4 h-4" /> {t('pages.tabs.pages')}
                        </TabsTrigger>
                        <TabsTrigger value="layouts" className="flex items-center gap-2 px-4 data-[state=active]:bg-card data-[state=active]:text-foreground">
                            <Palette className="w-4 h-4" /> {t('pages.tabs.layouts')}
                        </TabsTrigger>
                    </TabsList>
                </div>

                <TabsContent value="pages" className="mt-0">
                    {/* Render regular pages (page_type = regular) */}
                    <PagesManager onlyVisual={true} embedded />
                </TabsContent>

                <TabsContent value="layouts" className="mt-0">
                    <ThemeLayoutManager embedded />
                </TabsContent>
            </Tabs>
        </AdminPageLayout>
    );
};

export default VisualPagesManager;
