
import React, { useState } from 'react';
import GenericContentManager from '@/components/dashboard/GenericContentManager';
import VisualPageBuilder from '@/components/visual-builder/VisualPageBuilder';
import { AdminPageLayout, PageHeader, PageTabs, TabsContent } from '@/templates/awadmintemplate01';
import { FileText, FolderOpen, Layers, Paintbrush } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * PagesManager - Manages pages with Visual Builder support.
 * Refactored to use awadmintemplate01 components for consistent UI.
 */
function PagesManager({ onlyVisual = false }) {
  const [activeTab, setActiveTab] = useState('pages');
  const [visualBuilderPage, setVisualBuilderPage] = useState(null);

  // Tab definitions
  const tabs = onlyVisual ? [] : [
    { value: 'pages', label: 'Pages', icon: FileText, color: 'blue' },
    { value: 'categories', label: 'Categories', icon: FolderOpen, color: 'purple' },
  ];

  // Dynamic breadcrumb based on active tab
  const breadcrumbs = [
    { label: onlyVisual ? 'Visual Pages' : 'Pages', href: activeTab !== 'pages' ? '/cmspanel/pages' : undefined, icon: Layers },
    ...(activeTab !== 'pages' && !onlyVisual ? [{ label: 'Categories' }] : []),
  ];

  // Page columns with editor type indicator
  const pageColumns = [
    { key: 'title', label: 'Page Title', className: 'font-medium' },
    { key: 'slug', label: 'Path' },
    {
      key: 'page_type',
      label: 'Type',
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
          homepage: 'Home',
          header: 'Header',
          footer: 'Footer',
          single_page: 'Page Tpl',
          single_post: 'Post Tpl',
          '404': '404',
          regular: 'Page'
        };
        return (
          <span className={`px-2 py-0.5 text-xs rounded-full font-medium border ${colors[value] || colors.regular}`}>
            {labels[value] || value || 'Page'}
          </span>
        );
      }
    },
    {
      key: 'editor_type',
      label: 'Editor',
      render: (value) => (
        <span className={`px-2 py-0.5 text-xs rounded-full border ${value === 'visual'
          ? 'bg-accent/10 text-accent-foreground border-accent/20'
          : 'bg-muted text-muted-foreground border-border'
          }`}>
          {value === 'visual' ? '🎨 Visual' : '📝 Rich Text'}
        </span>
      )
    },
    { key: 'status', label: 'Status' },
    { key: 'published_at', label: 'Published', type: 'date' },
    { key: 'updated_at', label: 'Updated', type: 'date' }
  ];

  const pageFormFields = [
    { key: 'title', label: 'Title', required: true },
    {
      key: 'page_type',
      label: 'Page Type',
      type: 'select',
      options: [
        { value: 'regular', label: 'Regular Page' },
        { value: 'homepage', label: 'Homepage' },
        { value: 'header', label: 'Global Header' },
        { value: 'footer', label: 'Global Footer' },
        { value: 'single_page', label: 'Single Page Template' },
        { value: 'single_post', label: 'Single Post Template' },
        { value: '404', label: '404 Error Page' },
        { value: 'archive', label: 'Archive Template' }
      ],
      defaultValue: 'regular',
      description: 'System page type (Homepage, Header, etc.)'
    },
    { key: 'slug', label: 'URL Slug', required: true },
    {
      key: 'status', label: 'Status', type: 'select', options: [
        { value: 'published', label: 'Published' },
        { value: 'draft', label: 'Draft' }
      ]
    },
    {
      key: 'editor_type', label: 'Editor Type', type: 'select', options: [
        { value: 'richtext', label: '📝 Rich Text Editor' },
        { value: 'visual', label: '🎨 Visual Page Builder' }
      ],
      defaultValue: onlyVisual ? 'visual' : 'richtext',
      description: 'Choose the editor type for this page',
    },
    { key: 'category_id', label: 'Category', type: 'resource_select', resourceTable: 'categories' },
    {
      key: 'content',
      label: 'Content',
      type: 'richtext',
      description: 'Page content (for Rich Text editor)',
      conditionalShow: (formData) => formData.editor_type !== 'visual'
    },
    { key: 'excerpt', label: 'Excerpt', type: 'textarea' },
    { key: 'featured_image', label: 'Featured Image', type: 'image' },
    { key: 'meta_description', label: 'SEO Description', type: 'textarea' },
    { key: 'is_active', label: 'Active', type: 'boolean' }
  ];

  // Custom row actions for Visual Builder
  const customRowActions = (page) => {
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
          title="Edit with Visual Builder"
        >
          <Paintbrush className="w-3 h-3 mr-1.5" />
          Edit Visual
        </Button>
      );
    }
    return null;
  };

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
        { value: 'page', label: 'Pages' },
        { value: 'article', label: 'Articles' },
        { value: 'product', label: 'Products' }
      ], defaultValue: 'page'
    }
  ];

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
        title={onlyVisual ? "Visual Pages" : "Pages"}
        description={onlyVisual ? "Build pages with drag-and-drop" : "Manage website pages and sections"}
        icon={Layers}
        breadcrumbs={breadcrumbs}
      />

      {/* Tabs Navigation (hidden for onlyVisual mode) */}
      {onlyVisual ? (
        <GenericContentManager
          tableName="pages"
          resourceName="Visual Page"
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
              resourceName="Page"
              columns={pageColumns}
              formFields={pageFormFields}
              permissionPrefix="pages"
              customRowActions={customRowActions}
              showBreadcrumbs={false}
            />
          </TabsContent>

          <TabsContent value="categories" className="mt-0">
            <GenericContentManager
              tableName="categories"
              resourceName="Category"
              columns={categoryColumns}
              formFields={categoryFormFields}
              permissionPrefix="categories"
              customSelect="*, owner:users!created_by(email, full_name), tenant:tenants(name)"
              defaultFilters={{ type: 'page' }}
              showBreadcrumbs={false}
            />
          </TabsContent>
        </PageTabs>
      )}
    </AdminPageLayout>
  );
}

export default PagesManager;
