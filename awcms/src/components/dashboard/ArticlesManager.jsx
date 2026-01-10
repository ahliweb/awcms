import React, { useState } from 'react';
import GenericContentManager from '@/components/dashboard/GenericContentManager';
import ArticleEditor from '@/components/dashboard/ArticleEditor';
import { AdminPageLayout, PageHeader, PageTabs, TabsContent } from '@/templates/awadmintemplate01';
import { FileText, FolderOpen, Tag, Layout, Monitor, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * ArticlesManager - Manages articles, categories, and tags.
 * Refactored to use awadmintemplate01 components for consistent UI.
 */
function ArticlesManager() {
  const [activeTab, setActiveTab] = useState('articles');

  // Tab definitions
  const tabs = [
    { value: 'articles', label: 'Articles', icon: FileText, color: 'blue' },
    { value: 'categories', label: 'Categories', icon: FolderOpen, color: 'purple' },
    { value: 'tags', label: 'Tags', icon: Tag, color: 'emerald' },
  ];

  // Dynamic breadcrumb based on active tab
  const breadcrumbs = [
    { label: 'Articles', href: activeTab !== 'articles' ? '/cmspanel/articles' : undefined, icon: FileText },
    ...(activeTab !== 'articles' ? [{ label: activeTab.charAt(0).toUpperCase() + activeTab.slice(1) }] : []),
  ];

  // Article columns and fields
  const articleColumns = [
    { key: 'title', label: 'Title', className: 'font-medium' },
    {
      key: 'workflow_state',
      label: 'Workflow',
      render: (value) => {
        const colors = {
          published: 'bg-green-100 text-green-700 border-green-200',
          approved: 'bg-blue-100 text-blue-700 border-blue-200',
          reviewed: 'bg-yellow-100 text-yellow-700 border-yellow-200',
          draft: 'bg-slate-100 text-slate-700 border-slate-200'
        };
        return (
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${colors[value] || colors.draft} capitalize`}>
            {value}
          </span>
        );
      }
    },
    { key: 'status', label: 'Visibility', className: 'capitalize' },
    { key: 'published_at', label: 'Published', type: 'date' },
    { key: 'views', label: 'Views', type: 'number' },
    {
      key: 'editor_type',
      label: 'Type',
      render: (value) => (
        value === 'visual' ?
          <span title="Visual Builder" className="inline-flex items-center justify-center w-6 h-6 rounded bg-indigo-50 text-indigo-600"><Layout className="w-3.5 h-3.5" /></span> :
          <span title="Standard Editor" className="inline-flex items-center justify-center w-6 h-6 rounded bg-slate-50 text-slate-500"><FileText className="w-3.5 h-3.5" /></span>
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

  const articleFormFields = [
    { key: 'title', label: 'Title', required: true },
    { key: 'slug', label: 'Slug' },
    {
      key: 'status', label: 'Status', type: 'select', options: [
        { value: 'draft', label: 'Draft' },
        { value: 'published', label: 'Published' },
        { value: 'archived', label: 'Archived' }
      ]
    },
    { key: 'category_id', label: 'Category', type: 'resource_select', resourceTable: 'categories' },
    { key: 'excerpt', label: 'Excerpt', type: 'textarea' },
    { key: 'content', label: 'Content', type: 'richtext', description: 'Main article content with WYSIWYG editor' },
    { key: 'featured_image', label: 'Featured Image', type: 'image', description: 'Upload or select from Media Library' },
    { key: 'tags', label: 'Tags', type: 'tags' },
    { key: 'is_public', label: 'Publicly Visible', type: 'boolean' }
  ];

  // Category columns and fields
  const categoryColumns = [
    { key: 'name', label: 'Name', className: 'font-medium' },
    { key: 'slug', label: 'Slug' },
    { key: 'description', label: 'Description' },
    { key: 'created_at', label: 'Created', type: 'date' }
  ];

  const categoryFormFields = [
    { key: 'name', label: 'Name', required: true },
    { key: 'slug', label: 'Slug' },
    { key: 'description', label: 'Description', type: 'textarea' },
    {
      key: 'type', label: 'Type', type: 'select', options: [
        { value: 'articles', label: 'Articles' },
        { value: 'product', label: 'Products' },
        { value: 'portfolio', label: 'Portfolio' }
      ], defaultValue: 'articles'
    }
  ];

  // Tag columns and fields
  const tagColumns = [
    { key: 'name', label: 'Name', className: 'font-medium' },
    { key: 'slug', label: 'Slug' },
    { key: 'created_at', label: 'Created', type: 'date' }
  ];

  const tagFormFields = [
    { key: 'name', label: 'Name', required: true },
    { key: 'slug', label: 'Slug' }
  ];

  return (
    <AdminPageLayout requiredPermission="tenant.articles.read">
      {/* Page Header with Breadcrumbs */}
      <PageHeader
        title="Articles"
        description="Manage your content, categories, and tags"
        icon={FileText}
        breadcrumbs={breadcrumbs}
      />

      {/* Tabs Navigation */}
      <PageTabs
        value={activeTab}
        onValueChange={setActiveTab}
        tabs={tabs}
      >
        <TabsContent value="articles" className="mt-0">
          <GenericContentManager
            tableName="articles"
            resourceName="Article"
            columns={articleColumns}
            formFields={articleFormFields}
            permissionPrefix="articles"
            showBreadcrumbs={false}
            EditorComponent={ArticleEditor}
            customRowActions={customRowActions}
            customToolbarActions={customToolbarActions}
          />
        </TabsContent>

        <TabsContent value="categories" className="mt-0">
          <GenericContentManager
            tableName="categories"
            resourceName="Category"
            columns={categoryColumns}
            formFields={categoryFormFields}
            permissionPrefix="categories"
            showBreadcrumbs={false}
            customSelect="*, owner:users!created_by(email, full_name), tenant:tenants(name)"
            defaultFilters={{ type: 'articles' }}
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

export default ArticlesManager;
