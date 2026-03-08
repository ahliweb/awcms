
import GenericContentManager from '@/components/dashboard/GenericContentManager';
import { FolderTree } from 'lucide-react';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';
import { Badge } from '@/components/ui/badge';
import { CATEGORY_SCOPE_OPTIONS, getCategoryScopeMeta } from '@/lib/taxonomy';
import { restoreCategory, softDeleteCategory } from '@/lib/taxonomyMutations';

function CategoriesManager() {
  const columns = [
    { key: 'name', label: 'Name', className: 'font-medium' },
    { key: 'slug', label: 'Slug' },
    {
      key: 'type',
      label: 'Scope',
      render: (value) => {
        const scope = getCategoryScopeMeta(value);

        return (
          <div className="space-y-1">
            <Badge variant="secondary">{scope?.label || value}</Badge>
            <p className="text-xs text-muted-foreground">{scope?.description || 'Tenant-scoped category set.'}</p>
          </div>
        );
      }
    }
  ];

  const formFields = [
    { key: 'name', label: 'Category Name', required: true, description: 'Visible label shown across selectors and lists.' },
    { key: 'slug', label: 'Slug' },
    { key: 'description', label: 'Description', type: 'textarea', description: 'Optional context so editors know when to reuse this taxonomy.' },
    {
      key: 'type',
      label: 'Scope',
      type: 'select',
      options: CATEGORY_SCOPE_OPTIONS,
      description: 'Pick the tenant module that should surface this category.'
    }
  ];

  return (
    <AdminPageLayout requiredPermission="tenant.categories.read">
        <PageHeader
          title="Categories"
          description="Manage shared and module-specific category scopes for each tenant. Shared content categories appear in both blog and page editors."
          icon={FolderTree}
          breadcrumbs={[{ label: 'Categories', icon: FolderTree }]}
        />

      <GenericContentManager
        tableName="categories"
        resourceName="Category"
        columns={columns}
        formFields={formFields}
        permissionPrefix="categories"
        viewPermission="tenant.categories.read"
        createPermission="tenant.categories.create"
        restorePermission="tenant.categories.restore"
        showBreadcrumbs={false}
        onSoftDeleteOverride={softDeleteCategory}
        onRestoreOverride={restoreCategory}
      />
    </AdminPageLayout>
  );
}

export default CategoriesManager;
