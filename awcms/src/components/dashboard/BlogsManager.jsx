import { useState } from 'react';
import { useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import BlogEditor from '@/components/dashboard/BlogEditor';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';
import { FileText, FolderOpen, Tag, Layout } from 'lucide-react';
import { Button } from '@/components/ui/button';
import useSplatSegments from '@/hooks/useSplatSegments';
import { encodeRouteParam } from '@/lib/routeSecurity';
import { cn } from '@/lib/utils';
import BlogsOverviewCards from '@/components/dashboard/blogs/BlogsOverviewCards';
import BlogsHeaderActions from '@/components/dashboard/blogs/BlogsHeaderActions';
import BlogsToolbarActions from '@/components/dashboard/blogs/BlogsToolbarActions';
import BlogsContentPanels from '@/components/dashboard/blogs/BlogsContentPanels';

/**
 * BlogsManager - Manages blogs, categories, and tags.
 * Refactored to use awadmintemplate01 components for consistent UI.
 */
function BlogsManager() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const segments = useSplatSegments();
  const [searchParams] = useSearchParams();
  const tabValues = ['blogs', 'categories', 'tags'];
  const viewValues = ['queue', 'trash'];
  const hasTabSegment = tabValues.includes(segments[0]);
  const hasViewSegment = viewValues.includes(segments[0]);
  const activeTab = hasTabSegment ? segments[0] : 'blogs';
  const activeView = hasViewSegment ? segments[0] : null;
  const hasExtraSegment = segments.length > 1;
  const hasValidTrashSuffix = segments[1] === 'trash';

  const [selectedLanguage, setSelectedLanguage] = useState('en');
  const [rebuildRequired, setRebuildRequired] = useState(false);
  const [isRebuilding, setIsRebuilding] = useState(false);
  const languages = useMemo(() => [
    { code: 'en', label: 'English', flag: '🇺🇸' },
    { code: 'id', label: 'Indonesia', flag: '🇮🇩' }
  ], []);
  const selectedLanguageLabel = useMemo(
    () => languages.find((language) => language.code === selectedLanguage)?.label || selectedLanguage.toUpperCase(),
    [languages, selectedLanguage]
  );

  const legacyEditId = searchParams.get('edit');
  const legacyStatus = searchParams.get('status');

  const blogFilters = useMemo(() => {
    const filters = {};
    if (activeView === 'queue') {
      filters.workflow_state = 'reviewed';
    }
    return filters;
  }, [activeView]);

  useEffect(() => {
    if (segments.length > 0 && !hasTabSegment && !hasViewSegment) {
      navigate('/cmspanel/blogs', { replace: true });
      return;
    }

    if (hasTabSegment && hasExtraSegment && !hasValidTrashSuffix) {
      const basePath = activeTab === 'blogs' ? '/cmspanel/blogs' : `/cmspanel/blogs/${activeTab}`;
      navigate(basePath, { replace: true });
      return;
    }

    if (hasViewSegment && segments.length > 1) {
      const viewPath = activeView === 'queue' ? '/cmspanel/blogs/queue' : '/cmspanel/blogs/trash';
      navigate(viewPath, { replace: true });
    }
  }, [segments, hasTabSegment, hasViewSegment, hasExtraSegment, hasValidTrashSuffix, activeTab, activeView, navigate]);

  useEffect(() => {
    if (segments.length > 0) return;
    if (legacyEditId) {
      const redirectLegacy = async () => {
        const routeId = await encodeRouteParam({ value: legacyEditId, scope: 'blogs.edit' });
        const nextPath = routeId ? `/cmspanel/blogs/edit/${routeId}` : '/cmspanel/blogs';
        navigate(nextPath, { replace: true });
      };
      redirectLegacy();
      return;
    }
    if (legacyStatus) {
      const nextPath = legacyStatus === 'reviewed' ? '/cmspanel/blogs/queue' : '/cmspanel/blogs';
      navigate(nextPath, { replace: true });
    }
  }, [segments.length, legacyEditId, legacyStatus, navigate]);

  // Handle rebuild notification
  const handleContentSaved = () => {
    setRebuildRequired(true);
  };

  const handleRebuild = async () => {
    setIsRebuilding(true);
    try {
      // Try to trigger rebuild via API (if available)
      const response = await fetch('/api/rebuild-public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        setRebuildRequired(false);
        alert('Public site rebuild started! Changes will be live in a few minutes.');
      } else {
        throw new Error('API not available');
      }
    } catch (_error) {
      // Show manual rebuild instructions
      setRebuildRequired(false);
      alert(
        'Rebuild Required!\n\n' +
        'To publish your changes to the public site, please run:\n\n' +
        'cd awcms-public/primary && npm run build\n\n' +
        'Then deploy the dist/ folder to your hosting provider.'
      );
    } finally {
      setIsRebuilding(false);
    }
  };

  // Tab definitions
  const tabs = [
    { value: 'blogs', label: t('menu.blogs'), icon: FileText, color: 'blue' },
    { value: 'categories', label: t('menu.categories'), icon: FolderOpen, color: 'purple' },
    { value: 'tags', label: t('menu.tags'), icon: Tag, color: 'emerald' },
  ];

  // Dynamic breadcrumb based on active tab
  const breadcrumbs = [
    { label: t('menu.blogs'), href: activeTab !== 'blogs' || activeView ? '/cmspanel/blogs' : undefined, icon: FileText },
    ...(activeView === 'queue' ? [{ label: t('common.review_queue', 'Review Queue') }] : []),
    ...(activeView === 'trash' ? [{ label: t('common.trash') }] : []),
    ...(activeTab !== 'blogs' ? [{ label: activeTab === 'categories' ? t('menu.categories') : t('menu.tags') }] : []),
  ];

  const activeSectionLabel =
    activeView === 'queue'
      ? t('common.review_queue', 'Review Queue')
      : activeView === 'trash'
        ? t('common.trash')
        : activeTab === 'categories'
          ? t('menu.categories')
          : activeTab === 'tags'
            ? t('menu.tags')
            : t('menu.blogs');

  const headerActions = (
    <BlogsHeaderActions
      t={t}
      activeTab={activeTab}
      activeView={activeView}
      selectedLanguageLabel={selectedLanguageLabel}
      navigate={navigate}
      rebuildRequired={rebuildRequired}
      onRebuild={handleRebuild}
      isRebuilding={isRebuilding}
    />
  );

  // Blog columns and fields
  const blogColumns = [
    {
      key: 'title',
      label: t('common.title'),
      className: 'min-w-[240px]',
      render: (value, row) => (
        <div className="space-y-0.5">
          <p className="truncate text-sm font-semibold text-foreground">{value || '-'}</p>
          <p className="truncate text-[11px] text-muted-foreground">/{row.slug || '-'}</p>
        </div>
      )
    },
    {
      key: 'locale',
      label: 'Lang',
      render: (value) => (
        <span className="inline-flex items-center rounded-full border border-border/70 bg-secondary px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-secondary-foreground">
          {value || 'en'}
        </span>
      )
    },
    {
      key: 'workflow_state',
      label: t('blogs.workflow'),
      render: (value) => {
        const colors = {
          published: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
          approved: 'border-primary/25 bg-primary/10 text-primary',
          reviewed: 'border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-500',
          draft: 'border-border/70 bg-muted text-muted-foreground'
        };
        return (
          <span className={cn('inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium capitalize', colors[value] || colors.draft)}>
            {value}
          </span>
        );
      }
    },
    {
      key: 'status',
      label: t('blogs.visibility'),
      render: (value) => (
        <span className={cn(
          'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium capitalize',
          value === 'published'
            ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
            : 'border-border/70 bg-secondary text-secondary-foreground'
        )}>
          {value || 'draft'}
        </span>
      )
    },
    { key: 'published_at', label: t('common.published'), type: 'date' },
    {
      key: 'views',
      label: t('blogs.views'),
      className: 'min-w-[110px]',
      render: (value) => (
        <span className="text-sm font-medium text-foreground">{value || 0}</span>
      )
    },
    {
      key: 'editor_type',
      label: t('blogs.type'),
      render: (value) => (
        <span className={cn(
          'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium',
          value === 'visual'
            ? 'border-primary/25 bg-primary/10 text-primary'
            : 'border-border/70 bg-muted text-muted-foreground'
        )}>
          {value === 'visual' ? <Layout className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
          {value === 'visual' ? t('blogs.visual_builder') : t('blogs.standard_editor')}
        </span>
      )
    }
  ];

  // Custom Actions
  const customRowActions = (item, { openEditor }) => (
    <Button
      size="sm"
      variant="outline"
      className="h-8 rounded-lg border-primary/25 bg-primary/10 px-3 text-xs font-semibold text-primary hover:bg-primary/15"
      title={t('blogs.visual_builder')}
      onClick={(e) => {
        e.stopPropagation();
        openEditor({ ...item, editor_type: 'visual' });
      }}
    >
      <Layout className="mr-1.5 h-3.5 w-3.5" />
      {t('blogs.visual_builder')}
    </Button>
  );

  const customToolbarActions = ({ openEditor }) => (
    <BlogsToolbarActions
      t={t}
      languages={languages}
      selectedLanguage={selectedLanguage}
      selectedLanguageLabel={selectedLanguageLabel}
      onLanguageChange={setSelectedLanguage}
      onCreateVisual={() => openEditor({ editor_type: 'visual', title: '', status: 'draft', locale: selectedLanguage })}
    />
  );

  const blogFormFields = [
    { key: 'title', label: t('blogs.form.title'), required: true },
    { key: 'slug', label: t('common.slug') },
    {
      key: 'status', label: t('common.status'), type: 'select', options: [
        { value: 'draft', label: t('common.draft') },
        { value: 'published', label: t('common.published') },
        { value: 'archived', label: t('common.archived') }
      ]
    },
    { key: 'category_id', label: t('common.category'), type: 'resource_select', resourceTable: 'categories' },
    { key: 'excerpt', label: t('blogs.form.excerpt'), type: 'textarea' },
    { key: 'content', label: t('blogs.form.content'), type: 'richtext', description: t('blogs.form.content_desc') || "Main blog content with WYSIWYG editor" },
    { key: 'featured_image', label: t('blogs.form.featured_image'), type: 'image', description: t('blogs.form.image_desc') || "Upload or select from Media Library" },
    { key: 'tags', label: t('common.tags'), type: 'tags' },
    { key: 'is_public', label: t('blogs.form.is_public'), type: 'boolean' },
    {
      key: 'locale',
      label: 'Language',
      type: 'select',
      options: languages.map(l => ({ value: l.code, label: l.label })),
      defaultValue: selectedLanguage,
      hidden: true // Hide from form, set implicitly or via top toolbar in editor
    }
  ];

  // Category columns and fields
  const categoryColumns = [
    { key: 'name', label: t('common.name'), className: 'font-medium' },
    { key: 'slug', label: t('common.slug') },
    { key: 'description', label: t('common.description') },
    { key: 'created_at', label: t('common.created_at'), type: 'date' }
  ];

  const categoryFormFields = [
    { key: 'name', label: t('common.name'), required: true },
    { key: 'slug', label: t('common.slug') },
    { key: 'description', label: t('common.description'), type: 'textarea' },
    {
      key: 'type', label: t('blogs.type'), type: 'select', options: [
        { value: 'blog', label: t('menu.blogs') },
        { value: 'product', label: t('menu.products') },
        { value: 'portfolio', label: t('menu.portfolio') }
      ], defaultValue: 'blog'
    }
  ];

  // Tag columns and fields
  const tagColumns = [
    { key: 'name', label: t('common.name'), className: 'font-medium' },
    { key: 'slug', label: t('common.slug') },
    { key: 'created_at', label: t('common.created_at'), type: 'date' }
  ];

  const tagFormFields = [
    { key: 'name', label: t('common.name'), required: true },
    { key: 'slug', label: t('common.slug') }
  ];

  return (
    <AdminPageLayout requiredPermission="tenant.blog.read">
      {/* Page Header with Breadcrumbs */}
      <PageHeader
        title={t('blogs.title')}
        description={t('blogs.subtitle')}
        icon={FileText}
        breadcrumbs={breadcrumbs}
        actions={headerActions}
      />

      <BlogsOverviewCards
        t={t}
        activeSectionLabel={activeSectionLabel}
        selectedLanguage={selectedLanguage}
        selectedLanguageLabel={selectedLanguageLabel}
        activeView={activeView}
      />

      <BlogsContentPanels
        activeTab={activeTab}
        tabs={tabs}
        navigate={navigate}
        t={t}
        blogColumns={blogColumns}
        blogFormFields={blogFormFields}
        blogFilters={blogFilters}
        BlogEditorComponent={BlogEditor}
        customRowActions={customRowActions}
        customToolbarActions={customToolbarActions}
        categoryColumns={categoryColumns}
        categoryFormFields={categoryFormFields}
        tagColumns={tagColumns}
        tagFormFields={tagFormFields}
        onContentSaved={handleContentSaved}
      />
    </AdminPageLayout>
  );
}

export default BlogsManager;
