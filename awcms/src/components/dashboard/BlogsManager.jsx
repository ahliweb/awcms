import { useState } from 'react';
import { useEffect, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import BlogEditor from '@/components/dashboard/BlogEditor';
import { useToast } from '@/components/ui/use-toast';
import { Calendar, ChevronRight, FileText, FolderOpen, Home, Layers3, Tag } from 'lucide-react';
import useSplatSegments from '@/hooks/useSplatSegments';
import { encodeRouteParam } from '@/lib/routeSecurity';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/contexts/PermissionContext';
import DashboardModuleIntro from '@/components/dashboard/DashboardModuleIntro';
import BlogsOverviewCards from '@/components/dashboard/blogs/BlogsOverviewCards';
import BlogsHeaderActions from '@/components/dashboard/blogs/BlogsHeaderActions';
import BlogsToolbarActions from '@/components/dashboard/blogs/BlogsToolbarActions';
import BlogsContentPanels from '@/components/dashboard/blogs/BlogsContentPanels';
import { getBlogEditorProps } from '@/components/dashboard/blogs/blogEditorConfig';
import { StatusBadge } from '@/components/ui/StatusBadge';

/**
 * BlogsManager - Manages blogs, categories, and tags.
 * Refactored to use awadmintemplate01 components for consistent UI.
 */
function BlogsManager() {
  const defaultBlogLanguage = 'id';
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
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

  const [selectedLanguage, setSelectedLanguage] = useState(defaultBlogLanguage);
  const [rebuildRequired, setRebuildRequired] = useState(false);
  const [isRebuilding, setIsRebuilding] = useState(false);
  const canView = hasPermission('tenant.blog.read');
  const languages = useMemo(() => [
    { code: 'en', label: 'English', flag: '🇺🇸' },
    { code: 'id', label: 'Indonesia', flag: '🇮🇩' }
  ], []);
  const selectedLanguageLabel = useMemo(
    () => languages.find((language) => language.code === selectedLanguage)?.label || selectedLanguage.toUpperCase(),
    [languages, selectedLanguage]
  );
  const selectedLanguageMeta = useMemo(
    () => languages.find((language) => language.code === selectedLanguage)
      || languages.find((language) => language.code === defaultBlogLanguage)
      || languages[0],
    [defaultBlogLanguage, languages, selectedLanguage]
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
        toast({
          title: 'Rebuild started',
          description: 'The public site rebuild is running and changes should be live soon.',
        });
      } else {
        throw new Error('API not available');
      }
    } catch (_error) {
      // Show manual rebuild instructions
      setRebuildRequired(false);
      toast({
        title: 'Manual rebuild required',
        description: 'Run `cd awcms-public/primary && npm run build`, then deploy the generated `dist/` output.',
      });
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
  const blogColumns = useMemo(() => [
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
      key: 'translation_status',
      label: t('common.language') || 'Language',
      render: (_value, row) => {
        const hasTranslation = selectedLanguage === 'id' || Boolean(row?.title_en);

        return (
          <span className={cn(
            'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide',
            hasTranslation
              ? 'border-primary/25 bg-primary/10 text-primary'
              : 'border-border/70 bg-secondary text-secondary-foreground'
          )}>
            {selectedLanguage}
          </span>
        );
      }
    },
    {
      key: 'workflow_state',
      label: t('blogs.workflow'),
      render: (value) => <StatusBadge status={value || 'draft'} />
    },
    {
      key: 'status',
      label: t('blogs.visibility'),
      render: (value) => <StatusBadge status={value || 'draft'} />
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
            ? 'border-amber-200 bg-amber-50 text-amber-700'
            : 'border-border/70 bg-muted text-muted-foreground'
        )}>
          <FileText className="h-3 w-3" />
          {value === 'visual' ? 'Legacy visual content' : t('blogs.standard_editor')}
        </span>
      )
    }
  ], [selectedLanguage, t]);

  const customToolbarActions = () => (
    <BlogsToolbarActions
      t={t}
      languages={languages}
      selectedLanguage={selectedLanguage}
      selectedLanguageLabel={selectedLanguageLabel}
      onLanguageChange={setSelectedLanguage}
    />
  );

  const blogFormFields = [
    { key: 'title', label: t('blogs.form.title'), required: true },
    { key: 'title_en', label: t('pages.form.title_en'), layout: 'main' },
    { key: 'slug', label: t('common.slug') },
    {
      key: 'slug_en',
      label: t('pages.form.slug_en'),
      description: t('pages.form.slug_en_desc'),
      autoGenerateFrom: 'title_en',
      layout: 'main'
    },
    {
      key: 'status', label: t('common.status'), type: 'select', options: [
        { value: 'draft', label: t('common.draft') },
        { value: 'published', label: t('common.published') },
        { value: 'archived', label: t('common.archived') }
      ]
    },
    { key: 'category_id', label: t('common.category'), type: 'resource_select', resourceTable: 'categories', filter: { type: ['blog', 'blogs', 'content'] } },
    { key: 'excerpt', label: t('blogs.form.excerpt'), type: 'textarea' },
    { key: 'excerpt_en', label: t('pages.form.excerpt_en'), type: 'textarea', layout: 'main' },
    { key: 'content', label: t('blogs.form.content'), type: 'richtext', description: t('blogs.form.content_desc') || "Main blog content with WYSIWYG editor" },
    {
      key: 'content_en',
      label: t('pages.form.content_en'),
      type: 'richtext',
      description: t('pages.form.content_en_desc'),
      layout: 'main'
    },
    { key: 'featured_image', label: t('blogs.form.featured_image'), type: 'image', description: t('blogs.form.image_desc') || "Upload or select from Media Library" },
    { key: 'tags', label: t('common.tags'), type: 'tags' },
    { key: 'is_public', label: t('blogs.form.is_public'), type: 'boolean' },
    { key: 'meta_description_en', label: t('pages.form.meta_desc_en'), type: 'textarea', description: t('pages.form.meta_desc_en_desc') }
  ];

  const blogEditorProps = useMemo(
    () => getBlogEditorProps(selectedLanguageMeta.code),
    [selectedLanguageMeta.code],
  );

  if (!canView) {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center rounded-2xl border border-border/60 bg-card/70 p-8 text-center text-muted-foreground shadow-sm">
        {t('common.access_denied')}
      </div>
    );
  }

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
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 font-medium transition-colors ${(activeTab !== 'blogs' || activeView)
                ? 'cursor-pointer border border-slate-900/10 bg-white/75 text-muted-foreground hover:bg-white dark:border-white/10 dark:bg-slate-900/55'
                : 'bg-slate-950 text-white shadow-sm dark:bg-white dark:text-slate-950'
                }`}
              onClick={(activeTab !== 'blogs' || activeView) ? () => navigate('/cmspanel/blogs', { replace: true }) : undefined}
            >
              <span>{t('menu.blogs')}</span>
            </div>
          </li>
          {activeView === 'queue' ? (
            <>
              <li aria-hidden="true" className="[&>svg]:size-3.5"><ChevronRight /></li>
              <li className="inline-flex items-center gap-1.5">
                <div className="flex items-center gap-1.5 rounded-full bg-slate-950 px-3 py-1 font-medium text-white shadow-sm dark:bg-white dark:text-slate-950">
                  <span>{t('common.review_queue', 'Review Queue')}</span>
                </div>
              </li>
            </>
          ) : null}
          {activeView === 'trash' ? (
            <>
              <li aria-hidden="true" className="[&>svg]:size-3.5"><ChevronRight /></li>
              <li className="inline-flex items-center gap-1.5">
                <div className="flex items-center gap-1.5 rounded-full bg-destructive px-3 py-1 font-medium text-destructive-foreground shadow-sm">
                  <span>{t('common.trash')}</span>
                </div>
              </li>
            </>
          ) : null}
          {!activeView && activeTab === 'categories' ? (
            <>
              <li aria-hidden="true" className="[&>svg]:size-3.5"><ChevronRight /></li>
              <li className="inline-flex items-center gap-1.5">
                <div className="flex items-center gap-1.5 rounded-full bg-slate-950 px-3 py-1 font-medium text-white shadow-sm dark:bg-white dark:text-slate-950">
                  <span>{t('menu.categories')}</span>
                </div>
              </li>
            </>
          ) : null}
          {!activeView && activeTab === 'tags' ? (
            <>
              <li aria-hidden="true" className="[&>svg]:size-3.5"><ChevronRight /></li>
              <li className="inline-flex items-center gap-1.5">
                <div className="flex items-center gap-1.5 rounded-full bg-slate-950 px-3 py-1 font-medium text-white shadow-sm dark:bg-white dark:text-slate-950">
                  <span>{t('menu.tags')}</span>
                </div>
              </li>
            </>
          ) : null}
        </ol>
      </nav>

      <div className="space-y-8">
        <DashboardModuleIntro
          icon={FileText}
          eyebrow="Blogs"
          title={activeSectionLabel}
          description={t('blogs.subtitle')}
          actions={headerActions}
          badges={[
            { icon: Layers3, iconClassName: 'text-primary', label: 'Refresh-safe `/cmspanel/blogs` routes' },
            { icon: FileText, iconClassName: 'text-primary', label: `Language: ${selectedLanguageLabel}` },
            { icon: Calendar, iconClassName: 'text-primary', label: activeView === 'trash' ? t('common.trash') : activeSectionLabel },
          ]}
        />

        <BlogsOverviewCards
          t={t}
          activeSectionLabel={activeSectionLabel}
          selectedLanguage={selectedLanguage}
          selectedLanguageLabel={selectedLanguageLabel}
          activeView={activeView}
        />
      </div>

      <BlogsContentPanels
        activeTab={activeTab}
        tabs={tabs}
        navigate={navigate}
        t={t}
        blogColumns={blogColumns}
        blogFormFields={blogFormFields}
        blogFilters={blogFilters}
        BlogEditorComponent={BlogEditor}
        customRowActions={null}
        customToolbarActions={customToolbarActions}
        blogEditorProps={blogEditorProps}
        onContentSaved={handleContentSaved}
      />
    </div>
  );
}

export default BlogsManager;
