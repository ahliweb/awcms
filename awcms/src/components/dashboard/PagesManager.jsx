import { useState, useMemo, useCallback, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import VisualPageBuilder from '@/components/visual-builder/VisualPageBuilder';
import { FileText, FolderOpen, Layers, Paintbrush, Tags, Home, ChevronRight, Calendar, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';
import useSplatSegments from '@/hooks/useSplatSegments';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/contexts/PermissionContext';
import { useTenant } from '@/contexts/TenantContext';
import DashboardModuleIntro from '@/components/dashboard/DashboardModuleIntro';
import PagesOverviewCards from '@/components/dashboard/pages/PagesOverviewCards';
import PagesContentPanels from '@/components/dashboard/pages/PagesContentPanels';
import { getPageEditorProps } from '@/components/dashboard/pages/pageEditorConfig';
import { supabase } from '@/lib/customSupabaseClient';
import { encodeRouteParam } from '@/lib/routeSecurity';

/**
 * PagesManager - Manages pages with Visual Builder support.
 * Refactored to use awadmintemplate01 components for consistent UI.
 */
function PagesManager({ onlyVisual = false, embedded = false }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { hasPermission, isPlatformAdmin } = usePermissions();
  const { currentTenant } = useTenant();
  const segments = useSplatSegments();
  const tabValues = ['pages', 'categories', 'tags'];
  const isTrashView = segments[0] === 'trash';
  const hasTabSegment = tabValues.includes(segments[0]);
  const activeTab = hasTabSegment ? segments[0] : 'pages';
  const hasExtraSegment = segments.length > 1;
  const hasValidTrashSuffix = segments[1] === 'trash';
  const [visualBuilderPage, setVisualBuilderPage] = useState(null);
  const [platformPages, setPlatformPages] = useState([]);
  const [platformPagesLoading, setPlatformPagesLoading] = useState(false);
  const [platformPagesPage, setPlatformPagesPage] = useState(1);
  const [platformPagesPerPage, setPlatformPagesPerPage] = useState(6);
  const [platformPagesTotal, setPlatformPagesTotal] = useState(0);
  const canView = hasPermission(onlyVisual ? 'tenant.visual_pages.read' : 'tenant.page.read');
  const platformPagesTotalPages = Math.max(1, Math.ceil(platformPagesTotal / platformPagesPerPage));

  // Tab definitions
  const tabs = useMemo(() => onlyVisual ? [] : [
    { value: 'pages', label: t('pages.tabs.pages'), icon: FileText, color: 'blue' },
    { value: 'categories', label: t('pages.tabs.categories'), icon: FolderOpen, color: 'purple' },
    { value: 'tags', label: t('pages.tabs.tags') || 'Tags', icon: Tags, color: 'green' },
  ], [onlyVisual, t]);

  useEffect(() => {
    if (!onlyVisual && segments.length > 0 && !hasTabSegment && !isTrashView) {
      navigate('/cmspanel/pages', { replace: true });
      return;
    }

    if (!onlyVisual && hasTabSegment && hasExtraSegment && !hasValidTrashSuffix) {
      const basePath = activeTab === 'pages' ? '/cmspanel/pages' : `/cmspanel/pages/${activeTab}`;
      navigate(basePath, { replace: true });
      return;
    }

    if (!onlyVisual && isTrashView && segments.length > 1) {
      navigate('/cmspanel/pages/trash', { replace: true });
    }
  }, [onlyVisual, segments, hasTabSegment, hasExtraSegment, hasValidTrashSuffix, isTrashView, activeTab, navigate]);

  // Page columns with editor type indicator
  const pageColumns = useMemo(() => [
    {
      key: 'title',
      label: t('pages.columns.title'),
      className: 'min-w-[220px]',
      render: (value, row) => (
        <div className="space-y-0.5">
          <p className="truncate text-sm font-semibold text-foreground">{value || '-'}</p>
          <p className="text-[11px] text-muted-foreground">/{row.slug || '-'}</p>
        </div>
      )
    },
    {
      key: 'slug',
      label: t('pages.columns.path'),
      className: 'min-w-[170px]',
      render: (value) => <span className="text-xs text-muted-foreground">/{value || '-'}</span>
    },
    {
      key: 'page_type',
      label: t('pages.columns.type'),
      render: (value) => {
        const colors = {
          homepage: 'border-primary/20 bg-primary/10 text-primary',
          header: 'border-border bg-muted text-muted-foreground',
          footer: 'border-border bg-muted text-muted-foreground',
          single_page: 'border-border bg-secondary text-secondary-foreground',
          single_post: 'border-border bg-secondary text-secondary-foreground',
          '404': 'border-destructive/20 bg-destructive/10 text-destructive',
          regular: 'border-border/70 bg-background/70 text-foreground'
        };
        const labels = {
          homepage: t('pages.badges.homepage'),
          header: t('pages.badges.header'),
          footer: t('pages.badges.footer'),
          single_page: t('pages.badges.single_page'),
          single_post: t('pages.badges.single_post'),
          '404': t('pages.badges.404'),
          regular: t('pages.badges.regular')
        };
        return (
          <span className={cn('inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium', colors[value] || colors.regular)}>
            {labels[value] || value || t('pages.badges.regular')}
          </span>
        );
      }
    },
    {
      key: 'category',
      label: t('pages.columns.category'),
      render: (value, row) => (
        row.category?.name ? (
          <span className="inline-flex items-center rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
            {row.category.name}
          </span>
        ) : <span className="text-xs text-muted-foreground">-</span>
      )
    },
    {
      key: 'editor_type',
      label: t('pages.columns.editor'),
      render: (value) => (
        <span className={cn(
          'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium',
          value === 'visual'
            ? 'border-primary/25 bg-primary/10 text-primary'
            : 'border-border/70 bg-muted text-muted-foreground'
        )}>
          {value === 'visual' ? <Paintbrush className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
          {value === 'visual' ? t('pages.badges.visual') : t('pages.badges.richtext')}
        </span>
      )
    },
    {
      key: 'status',
      label: t('pages.columns.status'),
      render: (value) => (
        <span className={cn(
          'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium capitalize',
          value === 'published'
            ? 'border border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
            : 'border border-border/70 bg-secondary text-secondary-foreground'
        )}>
          {value || 'draft'}
        </span>
      )
    },
    { key: 'published_at', label: t('pages.columns.published'), type: 'date' },
    { key: 'updated_at', label: t('pages.columns.updated'), type: 'date' }
  ], [t]);

  const pageFormFields = [
    { key: 'title', label: t('pages.form.title'), required: true },
    { key: 'title_en', label: t('pages.form.title_en'), layout: 'main' },
    {
      key: 'page_type',
      label: t('pages.form.page_type'),
      type: 'select',
      options: [
        { value: 'regular', label: t('pages.form.page_type_regular') }
      ],
      defaultValue: 'regular',
      description: t('pages.form.page_type_desc')
    },
    { key: 'slug', label: t('pages.form.slug'), required: true },
    {
      key: 'slug_en',
      label: t('pages.form.slug_en'),
      description: t('pages.form.slug_en_desc'),
      autoGenerateFrom: 'title_en',
      layout: 'main'
    },
    {
      key: 'status', label: t('pages.form.status'), type: 'select', options: [
        { value: 'published', label: t('pages.form.status_published') },
        { value: 'draft', label: t('pages.form.status_draft') }
      ]
    },
    {
      key: 'editor_type', label: t('pages.form.editor_type'), type: 'select', options: [
        { value: 'richtext', label: t('pages.form.editor_richtext') },
        { value: 'visual', label: t('pages.form.editor_visual') }
      ],
      defaultValue: onlyVisual ? 'visual' : 'richtext',
      description: t('pages.form.editor_desc'),
    },
    { key: 'category_id', label: t('pages.form.category'), type: 'resource_select', resourceTable: 'categories', filter: { type: ['page', 'pages', 'content'] } },
    { key: 'tags', label: t('pages.form.tags') || 'Tags', type: 'tags', description: t('pages.form.tags_desc') || 'Add tags to organize your content' },
    {
      key: 'content',
      label: t('pages.form.content'),
      type: 'richtext',
      description: t('pages.form.content_desc'),
      conditionalShow: (formData) => formData.editor_type !== 'visual'
    },
    {
      key: 'content_en',
      label: t('pages.form.content_en'),
      type: 'richtext',
      description: t('pages.form.content_en_desc'),
      conditionalShow: (formData) => formData.editor_type !== 'visual',
      layout: 'main'
    },
    { key: 'excerpt', label: t('pages.form.excerpt'), type: 'textarea' },
    { key: 'excerpt_en', label: t('pages.form.excerpt_en'), type: 'textarea', layout: 'main' },
    { key: 'featured_image', label: t('pages.form.featured_image'), type: 'image' },
    // SEO Fields
    { key: 'meta_title', label: t('pages.form.meta_title') || 'Meta Title', type: 'text', description: 'SEO title (60 chars recommended)' },
    { key: 'meta_description', label: t('pages.form.meta_desc'), type: 'textarea' },
    { key: 'meta_description_en', label: t('pages.form.meta_desc_en'), type: 'textarea', description: t('pages.form.meta_desc_en_desc') },
    { key: 'meta_keywords', label: t('pages.form.meta_keywords') || 'Meta Keywords', type: 'text', description: 'Comma-separated keywords' },
    { key: 'og_image', label: t('pages.form.og_image') || 'OG Image', type: 'image', description: 'Social sharing image (1200x630 recommended)' },
    { key: 'canonical_url', label: t('pages.form.canonical_url') || 'Canonical URL', type: 'text', description: 'Full URL if this content exists elsewhere' },
    { key: 'is_active', label: t('pages.form.active'), type: 'boolean' }
  ];

  const pageEditorProps = useMemo(() => getPageEditorProps('id'), []);

  // Custom row actions for Visual Builder
  const customRowActions = useCallback((page) => {
    if (page.editor_type === 'visual') {
      return (
        <Button
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            setVisualBuilderPage(page);
          }}
          variant="outline"
          className="h-8 rounded-lg border-primary/25 bg-primary/10 px-3 text-xs font-semibold text-primary hover:bg-primary/15"
          title={t('pages.action_edit_visual')}
        >
          <Paintbrush className="mr-1.5 h-3.5 w-3.5" />
          {t('pages.action_edit_visual')}
        </Button>
      );
    }
    return null;
  }, [t]);

  const handleOpenPage = useCallback(async (page) => {
    if (page.editor_type === 'visual') {
      setVisualBuilderPage(page);
      return;
    }

    const routeId = await encodeRouteParam({ value: page.id, scope: 'pages.edit' });
    if (!routeId) return;
    navigate(`/cmspanel/pages/edit/${routeId}`);
  }, [navigate]);

  useEffect(() => {
    if (!isPlatformAdmin || onlyVisual || embedded || activeTab !== 'pages') return;

    let active = true;

    const loadPlatformPages = async () => {
      try {
        setPlatformPagesLoading(true);
        const from = (platformPagesPage - 1) * platformPagesPerPage;
        const to = from + platformPagesPerPage - 1;

        const { data, count, error } = await supabase
          .from('pages')
          .select('id, title, slug, status, editor_type, page_type, created_at, tenant_id', { count: 'exact' })
          .is('deleted_at', null)
          .is('tenant_id', null)
          .order('updated_at', { ascending: false })
          .range(from, to);

        if (error) throw error;
        if (!active) return;

        setPlatformPages(data || []);
        setPlatformPagesTotal(count || 0);
      } catch (error) {
        console.error('Error loading platform pages:', error);
      } finally {
        if (active) {
          setPlatformPagesLoading(false);
        }
      }
    };

    loadPlatformPages();

    return () => {
      active = false;
    };
  }, [isPlatformAdmin, onlyVisual, embedded, activeTab, platformPagesPage, platformPagesPerPage]);

  // If Visual Builder is open, show it full screen
  if (visualBuilderPage) {
    return (
      <VisualPageBuilder
        page={visualBuilderPage}
        onClose={() => setVisualBuilderPage(null)}
        onSuccess={() => setVisualBuilderPage(null)}
      />
    );
  }

  const content = (
    <div className="space-y-6">
      {!embedded && (
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
                className={`flex items-center gap-1.5 rounded-full px-3 py-1 font-medium transition-colors ${((activeTab !== 'pages') || isTrashView)
                  ? 'cursor-pointer bg-muted text-muted-foreground hover:bg-muted/80'
                  : 'bg-primary text-primary-foreground shadow-sm'
                  }`}
                onClick={(activeTab !== 'pages' || isTrashView) ? () => navigate('/cmspanel/pages', { replace: true }) : undefined}
              >
                <span>{onlyVisual ? t('pages.breadcrumbs.visual_pages') : t('pages.breadcrumbs.pages')}</span>
              </div>
            </li>
            {isTrashView && (
              <>
                <li aria-hidden="true" className="[&>svg]:size-3.5"><ChevronRight /></li>
                <li className="inline-flex items-center gap-1.5">
                  <div className="flex items-center gap-1.5 rounded-full bg-destructive px-3 py-1 font-medium text-destructive-foreground shadow-sm">
                    <span>{t('common.trash')}</span>
                  </div>
                </li>
              </>
            )}
            {!isTrashView && activeTab === 'categories' && !onlyVisual && (
              <>
                <li aria-hidden="true" className="[&>svg]:size-3.5"><ChevronRight /></li>
                <li className="inline-flex items-center gap-1.5">
                  <div className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 font-medium text-primary-foreground shadow-sm">
                    <span>{t('pages.breadcrumbs.categories')}</span>
                  </div>
                </li>
              </>
            )}
            {!isTrashView && activeTab === 'tags' && !onlyVisual && (
              <>
                <li aria-hidden="true" className="[&>svg]:size-3.5"><ChevronRight /></li>
                <li className="inline-flex items-center gap-1.5">
                  <div className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 font-medium text-primary-foreground shadow-sm">
                    <span>{t('pages.tabs.tags') || 'Tags'}</span>
                  </div>
                </li>
              </>
            )}
          </ol>
        </nav>
      )}

      {!embedded && (
        <div className="space-y-8">
          <DashboardModuleIntro
            icon={Layers}
            eyebrow="Pages"
            title={onlyVisual ? t('pages.visual_title') : isTrashView ? `${t('pages.title')} ${t('common.trash')}` : t('pages.title')}
            description={onlyVisual ? t('pages.visual_desc') : t('pages.subtitle')}
            badges={[
              { icon: Layers, iconClassName: 'text-primary', label: 'Refresh-safe `/cmspanel/pages` routes' },
              { icon: onlyVisual ? Paintbrush : FileText, iconClassName: 'text-primary', label: onlyVisual ? t('pages.badges.visual') : activeTab },
              { icon: Calendar, iconClassName: 'text-primary', label: isTrashView ? t('common.trash') : t('common.active', 'Active') },
            ]}
          />

          <PagesOverviewCards
            t={t}
            onlyVisual={onlyVisual}
            activeTab={activeTab}
            isTrashView={isTrashView}
          />
        </div>
      )}

      {embedded && (
        <PagesOverviewCards
          t={t}
          onlyVisual={onlyVisual}
          activeTab={activeTab}
          isTrashView={isTrashView}
        />
      )}

      {!embedded && !onlyVisual && activeTab === 'pages' && isPlatformAdmin ? (
        <div className="space-y-4 rounded-2xl border border-border/60 bg-card/70 p-5 shadow-sm backdrop-blur-sm">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-foreground">Platform-Scope Page Cards</h3>
              <p className="text-sm text-muted-foreground">Global pages remain manageable here even when the tenant-dependent pages section below is scoped to the active tenant.</p>
            </div>
            <div className="inline-flex items-center rounded-full border border-border/70 bg-background/70 px-3 py-1.5 text-xs font-medium text-muted-foreground">
              {platformPagesTotal} platform-scope pages
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {platformPagesLoading ? Array.from({ length: platformPagesPerPage }).map((_, index) => (
              <div key={index} className="h-44 animate-pulse rounded-2xl border border-border/60 bg-muted/40" />
            )) : platformPages.map((page) => (
              <div key={page.id} className="rounded-2xl border border-border/60 bg-background/90 p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{page.title || '-'}</p>
                    <p className="truncate text-xs text-muted-foreground">/{page.slug || '-'}</p>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-500">
                    <Sparkles className="h-3 w-3" />
                    Platform
                  </span>
                </div>

                <div className="mt-4 space-y-2 text-xs text-muted-foreground">
                  <div className="flex items-center justify-between gap-3">
                    <span>Type</span>
                    <span className="font-medium text-foreground">{page.page_type || 'regular'}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Editor</span>
                    <span className="font-medium text-foreground">{page.editor_type || 'richtext'}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Status</span>
                    <span className="font-medium text-foreground">{page.status || 'draft'}</span>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-muted-foreground">Created {page.created_at ? new Date(page.created_at).toLocaleDateString() : '-'}</span>
                  <Button size="sm" variant="outline" className="rounded-xl" onClick={() => handleOpenPage(page)}>
                    {page.editor_type === 'visual' ? 'Open Builder' : 'Edit'}
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-3 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-muted-foreground">
              Showing {platformPages.length === 0 ? 0 : ((platformPagesPage - 1) * platformPagesPerPage) + 1} to {Math.min(platformPagesPage * platformPagesPerPage, platformPagesTotal)} of {platformPagesTotal} platform-scope pages
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={platformPagesPerPage}
                onChange={(e) => {
                  setPlatformPagesPerPage(Number(e.target.value));
                  setPlatformPagesPage(1);
                }}
                className="h-10 rounded-xl border border-border/70 bg-background px-3 text-sm text-foreground shadow-sm"
              >
                {[3, 6, 9, 12].map((value) => (
                  <option key={value} value={value}>{value} / page</option>
                ))}
              </select>
              <Button variant="outline" className="rounded-xl" disabled={platformPagesPage <= 1} onClick={() => setPlatformPagesPage((page) => Math.max(1, page - 1))}>
                Previous
              </Button>
              <span className="px-2 text-sm text-muted-foreground">Page {platformPagesPage} of {platformPagesTotalPages}</span>
              <Button variant="outline" className="rounded-xl" disabled={platformPagesPage >= platformPagesTotalPages} onClick={() => setPlatformPagesPage((page) => Math.min(platformPagesTotalPages, page + 1))}>
                Next
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {!embedded && !onlyVisual && activeTab === 'pages' ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Tenant-Dependent Page Management</p>
            <p className="text-xs text-muted-foreground">{currentTenant?.name || (isPlatformAdmin ? 'Global scope' : 'Current tenant')}</p>
          </div>
        </div>
      ) : null}

      <PagesContentPanels
        onlyVisual={onlyVisual}
        activeTab={activeTab}
        tabs={tabs}
        navigate={navigate}
        t={t}
        pageColumns={pageColumns}
        pageFormFields={pageFormFields}
        pageEditorProps={pageEditorProps}
        customRowActions={customRowActions}
      />
    </div>
  );

  if (embedded) {
    return content;
  }

  if (!canView) {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center rounded-2xl border border-border/60 bg-card/70 p-8 text-center text-muted-foreground shadow-sm">
        {t('common.access_denied')}
      </div>
    );
  }

  return content;
}

export default PagesManager;
