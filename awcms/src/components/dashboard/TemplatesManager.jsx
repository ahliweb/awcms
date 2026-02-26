import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AdminPageLayout, PageHeader, PageTabs, TabsContent } from '@/templates/flowbite-admin';
import TemplatesList from './templates/TemplatesList';
import TemplatePartsList from './templates/TemplatePartsList';
import TemplateAssignments from './templates/TemplateAssignments';
import TemplateLanguageManager from './templates/TemplateLanguageManager';
import { Layout, Puzzle, Link2, Languages, Sparkles, Blocks, Globe, Lock, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import useSplatSegments from '@/hooks/useSplatSegments';
import { cn } from '@/lib/utils';

/**
 * TemplatesManager - Manages admin templates and configurations.
 * RESTRICTED: Only accessible to platform admin or full-access roles.
 * Refactored to use awadmintemplate01 with ABAC enforcement.
 */
const TemplatesManager = () => {
    const navigate = useNavigate();
    const segments = useSplatSegments();
    const tabValues = ['pages', 'parts', 'assignments', 'languages'];
    const hasTabSegment = tabValues.includes(segments[0]);
    const activeTab = hasTabSegment ? segments[0] : 'pages';
    const hasExtraSegment = segments.length > 1;

    // Tab definitions
    const tabs = [
        { value: 'pages', label: 'Page Templates', icon: Layout, color: 'blue' },
        { value: 'parts', label: 'Template Parts', icon: Puzzle, color: 'purple' },
        { value: 'assignments', label: 'Assignments', icon: Link2, color: 'emerald' },
        { value: 'languages', label: 'Languages', icon: Languages, color: 'amber' },
    ];

    const tabThemes = {
        pages: {
            shell: 'from-primary/12 via-background/40 to-emerald-500/12',
            badge: 'border-primary/25 bg-primary/10 text-primary',
        },
        parts: {
            shell: 'from-amber-500/12 via-background/40 to-primary/12',
            badge: 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300',
        },
        assignments: {
            shell: 'from-emerald-500/12 via-background/40 to-primary/12',
            badge: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
        },
        languages: {
            shell: 'from-primary/12 via-background/40 to-sky-500/12',
            badge: 'border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300',
        },
    };

    const tabInsights = {
        pages: {
            title: 'Blueprints for reusable page structures',
            detail: 'Compose global visual blocks and open in Visual Editor with signed route params.',
        },
        parts: {
            title: 'Reusable section modules',
            detail: 'Manage headers, footers, sidebars, and widget areas across template families.',
        },
        assignments: {
            title: 'Controlled mapping orchestration',
            detail: 'Bind templates to page groups with centralized assignment control.',
        },
        languages: {
            title: 'Localization governance',
            detail: 'Manage language-aware template strings for multi-region content delivery.',
        },
    };

    useEffect(() => {
        if (segments.length > 0 && !hasTabSegment) {
            navigate('/cmspanel/templates', { replace: true });
            return;
        }

        if (hasTabSegment && hasExtraSegment) {
            const basePath = activeTab === 'pages' ? '/cmspanel/templates' : `/cmspanel/templates/${activeTab}`;
            navigate(basePath, { replace: true });
        }
    }, [segments, hasTabSegment, hasExtraSegment, activeTab, navigate]);

    // Breadcrumb
    const breadcrumbs = [
        { label: 'Templates', icon: Layout },
    ];

    const activeTabConfig = tabs.find((tab) => tab.value === activeTab) || tabs[0];
    const activeTheme = tabThemes[activeTab] || tabThemes.pages;
    const activeInsight = tabInsights[activeTab] || tabInsights.pages;

    const headerActions = (
        <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-border/70 bg-background/70 p-1.5 shadow-sm">
            {tabs.map((tab) => (
                <Button
                    key={tab.value}
                    variant="ghost"
                    onClick={() => navigate(tab.value === 'pages' ? '/cmspanel/templates' : `/cmspanel/templates/${tab.value}`)}
                    className={cn(
                        'h-9 rounded-xl px-3 text-xs font-medium',
                        activeTab === tab.value
                            ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90'
                            : 'text-muted-foreground hover:bg-accent/70 hover:text-foreground'
                    )}
                >
                    <tab.icon className="mr-1.5 h-3.5 w-3.5" />
                    {tab.label}
                </Button>
            ))}
        </div>
    );

    return (
        <AdminPageLayout
            requiredPermission="platform.template.manage"
            showTenantBadge={false}
        >
            {/* Page Header */}
            <PageHeader
                title="Templates"
                description="Manage page templates, parts, and language assignments"
                icon={Layout}
                breadcrumbs={breadcrumbs}
                actions={headerActions}
            />

            <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-border/60 bg-card/65 p-4 shadow-sm backdrop-blur-sm">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Active Area</p>
                            <p className="mt-1 text-sm font-semibold text-foreground">{activeTabConfig.label}</p>
                            <p className="text-xs text-muted-foreground">Template management workspace</p>
                        </div>
                        <span className={cn('rounded-xl border p-2', activeTheme.badge)}>
                            <activeTabConfig.icon className="h-4 w-4" />
                        </span>
                    </div>
                </div>

                <div className="rounded-2xl border border-border/60 bg-card/65 p-4 shadow-sm backdrop-blur-sm">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Sections</p>
                            <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{tabs.length}</p>
                            <p className="text-xs text-muted-foreground">Pages, parts, assignments, i18n</p>
                        </div>
                        <span className="rounded-xl border border-primary/25 bg-primary/10 p-2 text-primary">
                            <Sparkles className="h-4 w-4" />
                        </span>
                    </div>
                </div>

                <div className="rounded-2xl border border-border/60 bg-card/65 p-4 shadow-sm backdrop-blur-sm">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Route Security</p>
                            <p className="mt-1 text-sm font-semibold text-foreground">Signed IDs</p>
                            <p className="text-xs text-muted-foreground">Scoped visual editor routing</p>
                        </div>
                        <span className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-2 text-emerald-700 dark:text-emerald-300">
                            <Lock className="h-4 w-4" />
                        </span>
                    </div>
                </div>

                <div className="rounded-2xl border border-border/60 bg-card/65 p-4 shadow-sm backdrop-blur-sm">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Localization</p>
                            <p className="mt-1 text-sm font-semibold text-foreground">Multi-language</p>
                            <p className="text-xs text-muted-foreground">Template string support</p>
                        </div>
                        <span className="rounded-xl border border-primary/25 bg-primary/10 p-2 text-primary">
                            <Languages className="h-4 w-4" />
                        </span>
                    </div>
                </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/70 shadow-sm backdrop-blur-sm">
                <div className={cn('border-b border-border/70 bg-gradient-to-r p-4 sm:p-5', activeTheme.shell)}>
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-1.5">
                            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                                <Sparkles className="h-3.5 w-3.5 text-primary" />
                                Templates Module Shell
                            </div>
                            <h3 className="text-base font-semibold text-foreground">{activeInsight.title}</h3>
                            <p className="max-w-2xl text-sm text-muted-foreground">{activeInsight.detail}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center rounded-full border border-border/70 bg-background/80 px-3 py-1.5 text-xs font-medium text-muted-foreground">
                                <Blocks className="mr-1.5 h-3.5 w-3.5 text-primary" />
                                4 managed sections
                            </span>
                            <span className="inline-flex items-center rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                                Sub-slug tabs ready
                            </span>
                            <span className="inline-flex items-center rounded-full border border-sky-500/25 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-700 dark:text-sky-300">
                                <Globe className="mr-1.5 h-3.5 w-3.5" />
                                Multi-language workflow
                            </span>
                        </div>
                    </div>
                </div>

                <div className="p-4 sm:p-5">
                    {/* Tabs Navigation */}
                    <PageTabs
                        value={activeTab}
                        onValueChange={(value) => {
                            navigate(value === 'pages' ? '/cmspanel/templates' : `/cmspanel/templates/${value}`);
                        }}
                        tabs={tabs}
                    >
                        <TabsContent value="pages" className="mt-0">
                            <TemplatesList />
                        </TabsContent>

                        <TabsContent value="parts" className="mt-0">
                            <TemplatePartsList />
                        </TabsContent>

                        <TabsContent value="assignments" className="mt-0">
                            <TemplateAssignments />
                        </TabsContent>

                        <TabsContent value="languages" className="mt-0">
                            <TemplateLanguageManager />
                        </TabsContent>
                    </PageTabs>
                </div>
            </div>
        </AdminPageLayout>
    );
};

export default TemplatesManager;
