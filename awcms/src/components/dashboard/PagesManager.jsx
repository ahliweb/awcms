import { useState, useMemo, useCallback } from 'react';
import GenericContentManager from '@/components/dashboard/GenericContentManager';
import VisualPageBuilder from '@/components/visual-builder/VisualPageBuilder';
import { AdminPageLayout, PageHeader, PageTabs, TabsContent } from '@/templates/flowbite-admin';
import { FileText, FolderOpen, Layers, Paintbrush, Tags } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';

/**
 * PagesManager - Manages pages with Visual Builder support.
 * Refactored to use awadmintemplate01 components for consistent UI.
 */
function PagesManager({ onlyVisual = false }) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('pages');
  const [visualBuilderPage, setVisualBuilderPage] = useState(null);

  // Tab definitions
  const tabs = useMemo(() => onlyVisual ? [] : [
    { value: 'pages', label: t('pages.tabs.pages'), icon: FileText, color: 'blue' },
    { value: 'categories', label: t('pages.tabs.categories'), icon: FolderOpen, color: 'purple' },
    { value: 'tags', label: t('pages.tabs.tags') || 'Tags', icon: Tags, color: 'green' },
  ], [onlyVisual, t]);

  // Dynamic breadcrumb based on active tab
  const breadcrumbs = useMemo(() => [
    { label: onlyVisual ? t('pages.breadcrumbs.visual_pages') : t('pages.breadcrumbs.pages'), href: activeTab !== 'pages' ? '/cmspanel/pages' : undefined, icon: Layers },
    ...(activeTab !== 'pages' && !onlyVisual ? [{ label: t('pages.breadcrumbs.categories') }] : []),
  ], [onlyVisual, activeTab, t]);

  // Page columns with editor type indicator
  const pageColumns = useMemo(() => [
    { key: 'title', label: t('pages.columns.title'), className: 'font-medium' },
    { key: 'slug', label: t('pages.columns.path') },
    {
      key: 'page_type',
      label: t('pages.columns.type'),
      render: (value) => {
        const colors = {
          homepage: 'bg-primary/10 text-primary border-primary/20',
          header: 'bg-muted text-muted-foreground border-border',
          footer: 'bg-muted text-muted-foreground border-border',
          single_page: 'bg-secondary text-secondary-foreground',
          single_post: 'bg-secondary text-secondary-foreground',
          '404': 'bg-destructive/10 text-destructive border-destructive/20',
          regular: 'bg-card text-card-foreground border-border border'
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
          <span className={`px-2 py-0.5 text-xs rounded-full font-medium border ${colors[value] || colors.regular}`}>
            {labels[value] || value || t('pages.badges.regular')}
          </span>
        );
      }
    },
    {
      key: 'category',
      label: t('pages.columns.category'),
      render: (value, row) => (
        <span className="text-sm text-muted-foreground">
          {row.category?.name || '-'}
        </span>
      )
    },
    {
      key: 'editor_type',
      label: t('pages.columns.editor'),
      render: (value) => (
        <span className={`px-2 py-0.5 text-xs rounded-full border ${value === 'visual'
          ? 'bg-accent/10 text-accent-foreground border-accent/20'
          : 'bg-muted text-muted-foreground border-border'
          }`}>
          {value === 'visual' ? `🎨 ${t('pages.badges.visual')}` : `📝 ${t('pages.badges.richtext')}`}
        </span>
      )
    },
    { key: 'status', label: t('pages.columns.status') },
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
      key: 'status', label: t('pages.form.status'), type: 'select', options: [
        { value: 'published', label: t('pages.form.status_published') },
        { value: 'draft', label: t('pages.form.status_draft') }
      ]
    },
    {
      key: 'editor_type', label: t('pages.form.editor_type'), type: 'select', options: [
        { value: 'richtext', label: `📝 ${t('pages.form.editor_richtext')}` },
        { value: 'visual', label: `🎨 ${t('pages.form.editor_visual')}` }
      ],
      defaultValue: onlyVisual ? 'visual' : 'richtext',
      description: t('pages.form.editor_desc'),
    },
    { key: 'category_id', label: t('pages.form.category'), type: 'resource_select', resourceTable: 'categories', filter: { type: 'page' } },
    { key: 'tags', label: t('pages.form.tags') || 'Tags', type: 'tag_input', description: t('pages.form.tags_desc') || 'Add tags to organize your content' },
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
  ], [onlyVisual, t]);

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
          className="h-7 px-2 text-xs border-accent text-accent-foreground hover:bg-accent/10"
          title={t('pages.action_edit_visual')}
        >
          <Paintbrush className="w-3 h-3 mr-1.5" />
          {t('pages.action_edit_visual')}
        </Button>
      );
    }
    return null;
  }, [t]);

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
        { value: 'page', label: t('pages.category.form.type_page') },
        { value: 'blog', label: t('pages.category.form.type_blog') },
        { value: 'product', label: t('pages.category.form.type_product') }
      ], defaultValue: 'page'
    }
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

      {/* Tabs Navigation (hidden for onlyVisual mode) */}
      {onlyVisual ? (
        <GenericContentManager
          tableName="pages"
          resourceName={t('pages.visual_title')} // Or generic "Visual Page" if strictly needed in singular, but title works
          columns={pageColumns}
          formFields={pageFormFields}
          permissionPrefix="visual_pages"
          customRowActions={customRowActions}
          defaultFilters={{ editor_type: 'visual' }}
          showBreadcrumbs={false}
        />
      ) : (
        <PageTabs
          value={activeTab}
          onValueChange={setActiveTab}
          tabs={tabs}
        >
          <TabsContent value="pages" className="mt-0">
            <GenericContentManager
              tableName="pages"
              resourceName={t('pages.badges.regular')}
              columns={pageColumns}
              formFields={pageFormFields}
              permissionPrefix="pages"
              defaultFilters={{ page_type: 'regular' }}
              customSelect="*, category:categories!pages_category_id_fkey(id, name), owner:users!created_by(email, full_name), tenant:tenants(name)"
              customRowActions={customRowActions}
              showBreadcrumbs={false}
            />
          </TabsContent>

          <TabsContent value="categories" className="mt-0">
            <GenericContentManager
              tableName="categories"
              resourceName={t('pages.category.form.type_page')} // Or Category singular
              columns={categoryColumns}
              formFields={categoryFormFields}
              permissionPrefix="categories"
              customSelect="*, owner:users!created_by(email, full_name), tenant:tenants(name)"
              defaultFilters={{ type: 'page' }}
              showBreadcrumbs={false}
            />
          </TabsContent>

          <TabsContent value="tags" className="mt-0">
            <GenericContentManager
              tableName="tags"
              resourceName={t('pages.tags.singular') || 'Tag'}
              columns={[
                { key: 'name', label: t('pages.tags.name') || 'Name', className: 'font-medium' },
                { key: 'slug', label: t('pages.tags.slug') || 'Slug' },
                { key: 'created_at', label: t('pages.tags.created') || 'Created', type: 'date' }
              ]}
              formFields={[
                { key: 'name', label: t('pages.tags.form.name') || 'Name', required: true },
                { key: 'slug', label: t('pages.tags.form.slug') || 'Slug' }
              ]}
              permissionPrefix="tags"
              customSelect="*, owner:users!created_by(email, full_name), tenant:tenants(name)"
              showBreadcrumbs={false}
            />
          </TabsContent>
        </PageTabs>
      )}
    </AdminPageLayout>
  );
}

export default PagesManager;
