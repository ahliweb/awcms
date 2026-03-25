import PagesManager from './PagesManager';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import ThemeLayoutManager from './ThemeLayoutManager';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Calendar, ChevronRight, Home, Layers, Palette, ShieldAlert } from 'lucide-react';
import { usePermissions } from '@/contexts/PermissionContext';
import useSplatSegments from '@/hooks/useSplatSegments';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

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

    const summaryCards = [
        {
            title: t('pages.tabs.pages'),
            value: activeTab === 'pages' ? 'Active' : 'Ready',
            description: 'Manage tenant visual pages with the visual builder and route-backed editing flow.',
            accent: 'from-primary/15 via-primary/6 to-transparent',
        },
        {
            title: t('pages.tabs.layouts'),
            value: activeTab === 'layouts' ? 'Active' : 'Ready',
            description: 'Update shared layout templates for headers, footers, archive screens, and single content views.',
            accent: 'from-sky-500/15 via-sky-500/6 to-transparent',
        },
        {
            title: 'Scope',
            value: 'Tenant',
            description: 'Visual pages stay aligned with tenant-facing publishing and template composition rules.',
            accent: 'from-emerald-500/15 via-emerald-500/6 to-transparent',
        },
    ];

    return (
        <div className="space-y-6">
            <nav className="mb-6">
                <ol className="flex flex-wrap items-center gap-1.5 break-words text-sm text-muted-foreground sm:gap-2.5">
                    <li className="inline-flex items-center gap-1.5">
                        <Link to="/cmspanel" className="flex items-center gap-1 transition-colors hover:text-foreground">
                            <Home className="h-4 w-4" />
                            Dashboard
                        </Link>
                    </li>
                    <li aria-hidden="true" className="[&>svg]:size-3.5"><ChevronRight /></li>
                    <li className="inline-flex items-center gap-1.5">
                        <div
                            className={`flex items-center gap-1.5 rounded-full px-3 py-1 font-medium transition-colors ${activeTab !== 'pages'
                                ? 'cursor-pointer bg-muted text-muted-foreground hover:bg-muted/80'
                                : 'bg-primary text-primary-foreground shadow-sm'
                                }`}
                            onClick={activeTab !== 'pages' ? () => navigate('/cmspanel/visual-pages', { replace: true }) : undefined}
                        >
                            <span>{t('pages.visual_title')}</span>
                        </div>
                    </li>
                    {activeTab === 'layouts' ? (
                        <>
                            <li aria-hidden="true" className="[&>svg]:size-3.5"><ChevronRight /></li>
                            <li className="inline-flex items-center gap-1.5">
                                <div className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 font-medium text-primary-foreground shadow-sm">
                                    <span>{t('pages.tabs.layouts')}</span>
                                </div>
                            </li>
                        </>
                    ) : null}
                </ol>
            </nav>

            <div className="space-y-8">
                <div className="rounded-3xl border border-border/70 bg-gradient-to-br from-background via-background to-primary/5 p-6 shadow-sm">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-1.5">
                            <div className="flex items-center gap-3">
                                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-sm">
                                    <Layers className="h-5 w-5" />
                                </span>
                                <div>
                                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Visual Pages</p>
                                    <p className="text-lg font-semibold text-foreground">{activeTab === 'layouts' ? t('pages.tabs.layouts') : t('pages.visual_builder')}</p>
                                </div>
                            </div>
                            <p className="max-w-3xl text-sm text-muted-foreground">Manage visual page compositions and shared page/blog templates from one editor surface.</p>
                        </div>
                    </div>

                    <div className="mt-5 flex flex-wrap gap-3 text-sm text-muted-foreground">
                        <span className="inline-flex items-center gap-2 rounded-full bg-background/70 px-3 py-1.5 shadow-sm">
                            <Layers className="h-4 w-4 text-primary" />
                            Refresh-safe `/cmspanel/visual-pages` routes
                        </span>
                        <span className="inline-flex items-center gap-2 rounded-full bg-background/70 px-3 py-1.5 shadow-sm">
                            {activeTab === 'layouts' ? <Palette className="h-4 w-4 text-primary" /> : <Layers className="h-4 w-4 text-primary" />}
                            {activeTab}
                        </span>
                        <span className="inline-flex items-center gap-2 rounded-full bg-background/70 px-3 py-1.5 shadow-sm">
                            <Calendar className="h-4 w-4 text-primary" />
                            Tenant visual workflow
                        </span>
                    </div>
                </div>

                <div className="rounded-[28px] border border-border/60 bg-gradient-to-br from-muted/50 via-background to-background p-3 shadow-sm">
                    <div className="grid gap-4 md:grid-cols-3">
                        {summaryCards.map((card) => (
                            <Card key={card.title} className="overflow-hidden rounded-2xl border-border/70 shadow-sm">
                                <CardContent className="relative p-5">
                                    <div className={cn('pointer-events-none absolute inset-0 bg-gradient-to-br', card.accent)} />
                                    <div className="relative">
                                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{card.title}</p>
                                        <p className="mt-3 text-4xl font-semibold leading-none text-foreground">{card.value}</p>
                                        <p className="mt-3 max-w-xs text-sm leading-6 text-muted-foreground">{card.description}</p>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </div>
            </div>

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
                    <PagesManager onlyVisual={true} embedded />
                </TabsContent>

                <TabsContent value="layouts" className="mt-0">
                    <ThemeLayoutManager embedded />
                </TabsContent>
            </Tabs>
        </div>
    );
};

export default VisualPagesManager;
