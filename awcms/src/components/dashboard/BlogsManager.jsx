import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import GenericContentManager from '@/components/dashboard/GenericContentManager';
import BlogEditor from '@/components/dashboard/BlogEditor';
import { AdminPageLayout, PageHeader, PageTabs, TabsContent } from '@/templates/flowbite-admin';
import { FileText, FolderOpen, Tag, Layout, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * BlogsManager - Manages blogs, categories, and tags.
 * Refactored to use awadmintemplate01 components for consistent UI.
 */
function BlogsManager() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('blogs');

  // Tab definitions
  // Tab definitions
  // Tab definitions
  const tabs = [
    { value: 'blogs', label: t('menu.blogs'), icon: FileText, color: 'blue' },
    { value: 'categories', label: t('menu.categories'), icon: FolderOpen, color: 'purple' },
    { value: 'tags', label: t('menu.tags'), icon: Tag, color: 'emerald' },
  ];

  // Dynamic breadcrumb based on active tab
  const breadcrumbs = [
    { label: t('menu.blogs'), href: activeTab !== 'blogs' ? '/cmspanel/blogs' : undefined, icon: FileText },
    ...(activeTab !== 'blogs' ? [{ label: activeTab === 'categories' ? t('menu.categories') : t('menu.tags') }] : []),
  ];

  // Blog columns and fields
  const blogColumns = [
    { key: 'title', label: t('common.title'), className: 'font-medium' },
    {
      key: 'workflow_state',
      label: t('blogs.workflow'),
      render: (value) => {
        const colors = {
          published: 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800',
          approved: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800',
          reviewed: 'bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-800',
          draft: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-muted dark:text-muted-foreground dark:border-border'
        };
        return (
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${colors[value] || colors.draft} capitalize`}>
            {value}
          </span>
        );
      }
    },
    { key: 'status', label: t('blogs.visibility'), className: 'capitalize' },
    { key: 'published_at', label: t('common.published'), type: 'date' },
    { key: 'views', label: t('blogs.views'), type: 'number' },
    {
      key: 'editor_type',
      label: t('blogs.type'),
      render: (value) => (
        value === 'visual' ?
          <span title={t('blogs.visual_builder')} className="inline-flex items-center justify-center w-6 h-6 rounded bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400"><Layout className="w-3.5 h-3.5" /></span> :
          <span title={t('blogs.standard_editor')} className="inline-flex items-center justify-center w-6 h-6 rounded bg-slate-50 text-slate-500 dark:bg-muted dark:text-muted-foreground"><FileText className="w-3.5 h-3.5" /></span>
      )
    }
  ];

  // Custom Actions
  const customRowActions = (item, { openEditor }) => (
    <Button
      size="icon"
      variant="ghost"
      className="text-indigo-600 hover:bg-indigo-50 h-8 w-8"
      title="Edit in Visual Builder"
      onClick={(e) => {
        e.stopPropagation();
        openEditor({ ...item, editor_type: 'visual' });
      }}
    >
      <Layout className="w-4 h-4" />
    </Button>
  );

  const customToolbarActions = ({ openEditor }) => (
    <Button
      onClick={() => openEditor({ editor_type: 'visual', title: '', status: 'draft' })}
      className="bg-indigo-600 hover:bg-indigo-700 text-white"
    >
      <Sparkles className="w-4 h-4 mr-2" />
      Create Visual
    </Button>
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
    { key: 'is_public', label: t('blogs.form.is_public'), type: 'boolean' }
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
      />

      {/* Tabs Navigation */}
      <PageTabs
        value={activeTab}
        onValueChange={setActiveTab}
        tabs={tabs}
      >
        <TabsContent value="blogs" className="mt-0">
          <GenericContentManager
            tableName="blogs"
            resourceName={t('blogs.type')}
            columns={blogColumns}
            formFields={blogFormFields}
            permissionPrefix="blog"
            showBreadcrumbs={false}
            EditorComponent={BlogEditor}
            customRowActions={customRowActions}
            customToolbarActions={customToolbarActions}
          />
        </TabsContent>

        <TabsContent value="categories" className="mt-0">
          <GenericContentManager
            tableName="categories"
            resourceName={t('common.category')}
            columns={categoryColumns}
            formFields={categoryFormFields}
            permissionPrefix="categories"
            showBreadcrumbs={false}
            customSelect="*, owner:users!created_by(email, full_name), tenant:tenants(name)"
            defaultFilters={{ type: 'blog' }}
          />
        </TabsContent>

        <TabsContent value="tags" className="mt-0">
          <GenericContentManager
            tableName="tags"
            resourceName="Tag"
            columns={tagColumns}
            formFields={tagFormFields}
            permissionPrefix="tags"
            showBreadcrumbs={false}
          />
        </TabsContent>
      </PageTabs>
    </AdminPageLayout>
  );
}

export default BlogsManager;
