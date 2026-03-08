import { useState, useMemo, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import VisualPageBuilder from '@/components/visual-builder/VisualPageBuilder';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';
import { FileText, FolderOpen, Layers, Paintbrush, Tags } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';
import useSplatSegments from '@/hooks/useSplatSegments';
import { cn } from '@/lib/utils';
import PagesOverviewCards from '@/components/dashboard/pages/PagesOverviewCards';
import PageLanguageToolbar from '@/components/dashboard/pages/PageLanguageToolbar';
import PagesContentPanels from '@/components/dashboard/pages/PagesContentPanels';

/**
 * PagesManager - Manages pages with Visual Builder support.
 * Refactored to use awadmintemplate01 components for consistent UI.
 */
function PagesManager({ onlyVisual = false }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const segments = useSplatSegments();
  const tabValues = ['pages', 'categories', 'tags'];
  const isTrashView = segments[0] === 'trash';
  const hasTabSegment = tabValues.includes(segments[0]);
  const activeTab = hasTabSegment ? segments[0] : 'pages';
  const hasExtraSegment = segments.length > 1;
  const hasValidTrashSuffix = segments[1] === 'trash';
  const [visualBuilderPage, setVisualBuilderPage] = useState(null);
  const [selectedLanguage, setSelectedLanguage] = useState('en');

  // Language options
  const languages = useMemo(() => [
    { value: 'en', label: 'English' },
    { value: 'id', label: 'Bahasa Indonesia' }
  ], []);

  const selectedLanguageLabel = useMemo(
    () => languages.find((language) => language.value === selectedLanguage)?.label || selectedLanguage.toUpperCase(),
    [languages, selectedLanguage]
  );

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

  // Dynamic breadcrumb based on active tab
  const breadcrumbs = useMemo(() => [
    { label: onlyVisual ? t('pages.breadcrumbs.visual_pages') : t('pages.breadcrumbs.pages'), href: activeTab !== 'pages' || isTrashView ? '/cmspanel/pages' : undefined, icon: Layers },
    ...(isTrashView ? [{ label: t('common.trash') }] : []),
    ...(activeTab === 'categories' && !onlyVisual ? [{ label: t('pages.breadcrumbs.categories') }] : []),
    ...(activeTab === 'tags' && !onlyVisual ? [{ label: t('pages.tabs.tags') || 'Tags' }] : []),
  ], [onlyVisual, activeTab, isTrashView, t]);

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
      key: 'locale',
      label: t('common.language') || 'Language',
      render: (value) => (
        <span className="inline-flex items-center rounded-full border border-border/70 bg-secondary px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-secondary-foreground">
          {value || 'en'}
        </span>
      )
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

  const pageFormFields = useMemo(() => [
    { key: 'title', label: t('pages.form.title'), required: true },
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
      key: 'locale',
      label: t('common.language'),
      type: 'select',
      options: languages,
      defaultValue: selectedLanguage,
      description: 'Language of this page'
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
    { key: 'excerpt', label: t('pages.form.excerpt'), type: 'textarea' },
    { key: 'featured_image', label: t('pages.form.featured_image'), type: 'image' },
    // SEO Fields
    { key: 'meta_title', label: t('pages.form.meta_title') || 'Meta Title', type: 'text', description: 'SEO title (60 chars recommended)' },
    { key: 'meta_description', label: t('pages.form.meta_desc'), type: 'textarea' },
    { key: 'meta_keywords', label: t('pages.form.meta_keywords') || 'Meta Keywords', type: 'text', description: 'Comma-separated keywords' },
    { key: 'og_image', label: t('pages.form.og_image') || 'OG Image', type: 'image', description: 'Social sharing image (1200x630 recommended)' },
    { key: 'canonical_url', label: t('pages.form.canonical_url') || 'Canonical URL', type: 'text', description: 'Full URL if this content exists elsewhere' },
    { key: 'is_active', label: t('pages.form.active'), type: 'boolean' }
  ], [onlyVisual, t, languages, selectedLanguage]);

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

  const renderLanguageToolbar = useCallback(() => (
    <PageLanguageToolbar
      t={t}
      languages={languages}
      selectedLanguage={selectedLanguage}
      selectedLanguageLabel={selectedLanguageLabel}
      onLanguageChange={setSelectedLanguage}
    />
  ), [languages, selectedLanguage, selectedLanguageLabel, t]);

  // Category columns and fields
  const categoryColumns = useMemo(() => [
    { key: 'name', label: t('pages.category.name'), className: 'font-medium' },
    { key: 'slug', label: t('pages.category.slug') },
    { key: 'description', label: t('pages.category.description') },
    { key: 'created_at', label: t('pages.category.created'), type: 'date' }
  ], [t]);

  const categoryFormFields = useMemo(() => [
    { key: 'name', label: t('pages.category.form.name'), required: true },
    { key: 'slug', label: t('pages.category.form.slug') },
    { key: 'description', label: t('pages.category.form.description'), type: 'textarea' },
    {
      key: 'type', label: t('pages.category.form.type'), type: 'select', options: [
        { value: 'content', label: 'Shared Content (Pages & Blogs)' },
        { value: 'page', label: t('pages.category.form.type_page') },
        { value: 'blog', label: t('pages.category.form.type_blog') }
      ], defaultValue: 'page'
    }
  ], [t]);

  const tagColumns = useMemo(() => [
    { key: 'name', label: t('pages.tags.name') || 'Name', className: 'font-medium' },
    { key: 'slug', label: t('pages.tags.slug') || 'Slug' },
    { key: 'created_at', label: t('pages.tags.created') || 'Created', type: 'date' }
  ], [t]);

  const tagFormFields = useMemo(() => [
    { key: 'name', label: t('pages.tags.form.name') || 'Name', required: true },
    { key: 'slug', label: t('pages.tags.form.slug') || 'Slug' }
  ], [t]);

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

  return (
    <AdminPageLayout requiredPermission={onlyVisual ? "tenant.visual_pages.read" : "tenant.pages.read"}>
      {/* Page Header with Breadcrumbs */}
      <PageHeader
        title={onlyVisual ? t('pages.visual_title') : t('pages.title')}
        description={onlyVisual ? t('pages.visual_desc') : t('pages.subtitle')}
        icon={Layers}
        breadcrumbs={breadcrumbs}
      />

      <PagesOverviewCards
        t={t}
        onlyVisual={onlyVisual}
        activeTab={activeTab}
        isTrashView={isTrashView}
        selectedLanguage={selectedLanguage}
        selectedLanguageLabel={selectedLanguageLabel}
      />

      <PagesContentPanels
        onlyVisual={onlyVisual}
        activeTab={activeTab}
        tabs={tabs}
        navigate={navigate}
        t={t}
        pageColumns={pageColumns}
        pageFormFields={pageFormFields}
        selectedLanguage={selectedLanguage}
        customRowActions={customRowActions}
        renderLanguageToolbar={renderLanguageToolbar}
        categoryColumns={categoryColumns}
        categoryFormFields={categoryFormFields}
        tagColumns={tagColumns}
        tagFormFields={tagFormFields}
      />
    </AdminPageLayout>
  );
}

export default PagesManager;
