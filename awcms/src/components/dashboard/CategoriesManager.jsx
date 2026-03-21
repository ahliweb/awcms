
import { useTranslation } from 'react-i18next';
import GenericContentManager from '@/components/dashboard/GenericContentManager';
import { Badge } from '@/components/ui/badge';
import { CATEGORY_SCOPE_OPTIONS, getCategoryScopeMeta } from '@/lib/taxonomy';
import { restoreCategory, softDeleteCategory } from '@/lib/taxonomyMutations';

function CategoriesManager() {
  const { t } = useTranslation();

  const columns = [
    { key: 'name', label: t('categories.columns.name'), className: 'font-medium' },
    { key: 'slug', label: t('categories.columns.slug') },
    {
      key: 'type',
      label: t('categories.columns.scope'),
      render: (value) => {
        const scope = getCategoryScopeMeta(value);

        return (
          <div className="space-y-1">
            <Badge variant="secondary">{scope?.label || value}</Badge>
            <p className="text-xs text-muted-foreground">{scope?.description || t('categories.scope_default')}</p>
          </div>
        );
      }
    }
  ];

  const formFields = [
    { key: 'name', label: t('categories.fields.name'), required: true, description: 'Visible label shown across selectors and lists.' },
    { key: 'slug', label: t('categories.fields.slug') },
    { key: 'description', label: t('categories.fields.description'), type: 'textarea', description: 'Optional context so editors know when to reuse this taxonomy.' },
    {
      key: 'type',
      label: t('categories.fields.scope'),
      type: 'select',
      options: CATEGORY_SCOPE_OPTIONS,
      description: 'Pick the tenant module that should surface this category.'
    }
  ];

  return (
    <GenericContentManager
      tableName="categories"
      resourceName="Category"
      columns={columns}
      formFields={formFields}
      permissionPrefix="categories"
      viewPermission="tenant.categories.read"
      createPermission="tenant.categories.create"
      restorePermission="tenant.categories.restore"
      onSoftDeleteOverride={softDeleteCategory}
      onRestoreOverride={restoreCategory}
    />
  );
}

export default CategoriesManager;
