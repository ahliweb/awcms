
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import GenericContentManager from '@/components/dashboard/GenericContentManager';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Package, Layers, FolderOpen, Sparkles, ShieldCheck } from 'lucide-react';
import { AdminPageLayout, PageHeader, PageTabs, TabsContent } from '@/templates/emdash-admin';
import useSplatSegments from '@/hooks/useSplatSegments';
import { restoreCategory, softDeleteCategory } from '@/lib/taxonomyMutations';
import { cn } from '@/lib/utils';

function ProductsManager() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const segments = useSplatSegments();
  const tabValues = ['types', 'categories'];
  const isTrashView = segments.includes('trash');
  const hasTabSegment = tabValues.includes(segments[0]);
  const activeTab = hasTabSegment ? segments[0] : 'products';
  const hasInvalidSegment = segments.length > 0 && !hasTabSegment && !isTrashView;
  const hasInvalidSubsegment = segments.length > 1 && segments[1] !== 'trash';

  useEffect(() => {
    if (hasInvalidSegment || hasInvalidSubsegment) {
      navigate(isTrashView ? '/cmspanel/products/trash' : '/cmspanel/products', { replace: true });
    }
  }, [hasInvalidSegment, hasInvalidSubsegment, isTrashView, navigate]);

  // Product columns
  const productColumns = [
    {
      key: 'featured_image',
      label: '',
      className: 'w-16',
      render: (val) => val ? (
        <img src={val} alt="" className="w-12 h-12 object-cover rounded-lg border border-border" />
      ) : (
        <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center">
          <Package className="w-6 h-6 text-muted-foreground" />
        </div>
      )
    },
    { key: 'name', label: t('products.product_name'), className: 'font-medium' },
    {
      key: 'sku',
      label: t('products.sku'),
      className: 'font-mono text-xs text-muted-foreground',
      render: (val) => val || <span className="text-muted-foreground/50">-</span>
    },
    {
      key: 'price',
      label: t('products.price'),
      render: (val, row) => (
        <div className="flex flex-col">
          {row.discount_price && row.discount_price < val ? (
            <>
              <span className="text-primary font-semibold">
                {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(row.discount_price)}
              </span>
              <span className="text-xs text-muted-foreground line-through">
                {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val)}
              </span>
            </>
          ) : (
            <span className="font-semibold">
              {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val)}
            </span>
          )}
        </div>
      )
    },
    {
      key: 'stock',
      label: t('products.stock'),
      render: (val) => {
        const status = val > 10 ? 'active' : val > 0 ? 'pending' : 'out_of_stock';
        const label = val > 0 ? String(val) : t('products.out_of_stock');
        return <StatusBadge status={status} label={label} />;
      }
    },
    {
      key: 'status',
      label: t('common.status'),
      render: (value) => (
        <StatusBadge status={value || 'draft'} label={value ? t(`products.status_options.${value}`) : t('common.draft')} />
      )
    }
  ];

  const productFormFields = [
    { key: 'name', label: t('products.product_name'), required: true, description: t('common.description') },
    { key: 'slug', label: t('common.slug'), description: 'URL-friendly name (auto-generated if empty)' },
    { key: 'sku', label: t('products.sku'), description: 'Stock Keeping Unit - unique product identifier' },
    { key: 'price', label: t('products.price'), type: 'number', required: true },
    { key: 'discount_price', label: t('products.discount_price'), type: 'number', description: 'Sale price (leave empty if no discount)' },
    { key: 'stock', label: t('products.stock'), type: 'number', description: 'Available inventory count' },
    { key: 'is_available', label: t('products.is_available'), type: 'boolean', description: 'Toggle product availability' },
    { key: 'shipping_cost', label: t('products.shipping_cost'), type: 'number', description: 'Standard shipping cost' },
    { key: 'weight', label: t('products.weight'), type: 'number', description: 'Product weight for shipping calculation' },
    { key: 'dimensions', label: t('products.dimensions'), description: 'L x W x H in cm (e.g., 30x20x10)' },
    { key: 'featured_image', label: t('products.main_image'), type: 'image', description: 'Product cover/thumbnail' },
    { key: 'images', label: t('products.gallery'), type: 'images', description: 'Additional product images', maxImages: 10 },
    { key: 'description', label: t('common.description'), type: 'richtext' },
    { key: 'category_id', label: t('common.category'), type: 'relation', table: 'categories', filter: { type: ['product', 'products'] } },
    { key: 'product_type_id', label: t('menu.product_types'), type: 'relation', table: 'product_types', description: 'Specific type/brand/collection' },
    // { key: 'tags', label: t('common.tags'), type: 'tags' }, // Removed
    { key: 'published_at', label: t('products.launch_date'), type: 'datetime' },
    {
      key: 'status', label: t('common.status'), type: 'select', options: [
        { value: 'draft', label: t('common.draft') },
        { value: 'active', label: t('common.active') },
        { value: 'out_of_stock', label: t('products.out_of_stock') },
        { value: 'archived', label: t('common.archived') }
      ]
    }
  ];

  // Product Types columns
  const typeColumns = [
    {
      key: 'icon',
      label: '',
      className: 'w-12',
      render: (val) => val ? (
        <div className="w-10 h-10 bg-muted rounded-lg flex items-center justify-center text-lg">
          {val.startsWith('http') ? (
            <img src={val} alt="" className="w-6 h-6 object-contain" />
          ) : (
            val
          )}
        </div>
      ) : (
        <div className="w-10 h-10 bg-muted rounded-lg flex items-center justify-center">
          <Layers className="w-5 h-5 text-muted-foreground" />
        </div>
      )
    },
    { key: 'name', label: t('products.type_name'), className: 'font-medium' },
    { key: 'slug', label: t('common.slug'), className: 'font-mono text-xs text-muted-foreground' },
    { key: 'created_at', label: t('common.created_at'), type: 'date' }
  ];

  const typeFormFields = [
    { key: 'name', label: t('products.type_name'), required: true, description: 'E.g., Electronics, Clothing, Food' },
    { key: 'slug', label: t('common.slug'), required: true, description: 'URL-friendly identifier' },
    { key: 'description', label: t('common.description'), type: 'textarea', description: 'Brief description of this product type' },
    { key: 'icon', label: t('products.icon'), description: 'Emoji or image URL' },
    { key: 'tags', label: t('common.tags'), type: 'tags', description: 'Keywords for filtering and search' }
  ];

  // Category columns for products
  const categoryColumns = [
    { key: 'name', label: t('common.name'), className: 'font-medium' },
    { key: 'slug', label: t('common.slug') },
    { key: 'description', label: t('common.description') },
    { key: 'created_at', label: t('common.created_at'), type: 'date' }
  ];

  const categoryFormFields = [
    { key: 'name', label: t('products.category_name'), required: true },
    { key: 'slug', label: t('common.slug') },
    { key: 'description', label: t('common.description'), type: 'textarea' },
    { key: 'type', label: t('blogs.type'), type: 'hidden', defaultValue: 'product' }
  ];

  const tabs = [
    { value: 'products', label: t('menu.products'), icon: Package, color: 'blue' },
    { value: 'types', label: t('menu.product_types'), icon: Layers, color: 'purple' },
    { value: 'categories', label: t('menu.categories'), icon: FolderOpen, color: 'emerald' },
  ];

  const activeTabMeta = {
    products: {
      title: t('products.workspace.products_title', 'Product catalog workflow'),
      detail: t('products.workspace.products_detail', 'Manage pricing, availability, publishing state, and storefront media from one tenant-safe workspace.'),
      shell: 'from-primary/12 via-background/40 to-emerald-500/12',
      badge: 'border-primary/25 bg-primary/10 text-primary',
      icon: Package,
    },
    types: {
      title: t('products.workspace.types_title', 'Product type taxonomy'),
      detail: t('products.workspace.types_detail', 'Keep collections, brands, or product families consistent across forms and filters.'),
      shell: 'from-violet-500/12 via-background/40 to-primary/12',
      badge: 'border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-300',
      icon: Layers,
    },
    categories: {
      title: t('products.workspace.categories_title', 'Category cleanup and storefront grouping'),
      detail: t('products.workspace.categories_detail', 'Review product categories, restore archived taxonomy, and keep storefront navigation tidy.'),
      shell: 'from-emerald-500/12 via-background/40 to-primary/12',
      badge: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
      icon: FolderOpen,
    },
  };

  const activeWorkspace = activeTabMeta[activeTab] || activeTabMeta.products;
  const ActiveWorkspaceIcon = activeWorkspace.icon;

  // Breadcrumbs for PageHeader
  const breadcrumbs = [
    { label: t('menu.products'), icon: Package },
    ...(isTrashView ? [{ label: t('common.trash') }] : []),
    ...(activeTab !== 'products' ? [{ label: activeTab === 'categories' ? t('menu.categories') : t('menu.product_types') }] : []),
  ];

  return (
    <AdminPageLayout requiredPermission="tenant.products.read">
      <PageHeader
        title={t('products.title')}
        description={t('products.subtitle')}
        icon={Package}
        breadcrumbs={breadcrumbs}
      />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-border/60 bg-card/70 p-4 shadow-sm backdrop-blur-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Active Area</p>
              <p className="mt-1 text-sm font-semibold text-foreground">{tabs.find((tab) => tab.value === activeTab)?.label || t('menu.products')}</p>
              <p className="text-xs text-muted-foreground">Product operations workspace</p>
            </div>
            <span className={cn('rounded-xl border p-2', activeWorkspace.badge)}>
              <ActiveWorkspaceIcon className="h-4 w-4" />
            </span>
          </div>
        </div>

        <div className="rounded-2xl border border-border/60 bg-card/70 p-4 shadow-sm backdrop-blur-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Sections</p>
              <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{tabs.length}</p>
              <p className="text-xs text-muted-foreground">Catalog, types, and categories</p>
            </div>
            <span className="rounded-xl border border-primary/25 bg-primary/10 p-2 text-primary">
              <Sparkles className="h-4 w-4" />
            </span>
          </div>
        </div>

        <div className="rounded-2xl border border-border/60 bg-card/70 p-4 shadow-sm backdrop-blur-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Taxonomy Sync</p>
              <p className="mt-1 text-sm font-semibold text-foreground">Shared category hygiene</p>
              <p className="text-xs text-muted-foreground">Restore and clean storefront taxonomy safely</p>
            </div>
            <span className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-2 text-emerald-700 dark:text-emerald-300">
              <FolderOpen className="h-4 w-4" />
            </span>
          </div>
        </div>

        <div className="rounded-2xl border border-border/60 bg-card/70 p-4 shadow-sm backdrop-blur-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Access Scope</p>
              <p className="mt-1 text-sm font-semibold text-foreground">Tenant ABAC</p>
              <p className="text-xs text-muted-foreground">Read and mutation controls remain permission-gated</p>
            </div>
            <span className="rounded-xl border border-sky-500/25 bg-sky-500/10 p-2 text-sky-700 dark:text-sky-300">
              <ShieldCheck className="h-4 w-4" />
            </span>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/70 shadow-sm backdrop-blur-sm">
        <div className={cn('border-b border-border/70 bg-gradient-to-r p-4 sm:p-5', activeWorkspace.shell)}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                Commerce Workspace
              </div>
              <h3 className="text-base font-semibold text-foreground">{activeWorkspace.title}</h3>
              <p className="max-w-2xl text-sm text-muted-foreground">{activeWorkspace.detail}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-full border border-border/70 bg-background/80 px-3 py-1.5 text-xs font-medium text-muted-foreground">
                <Package className="mr-1.5 h-3.5 w-3.5 text-primary" />
                Product CRUD stays refresh-safe
              </span>
              <span className="inline-flex items-center rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
                Trash-aware taxonomy restore
              </span>
            </div>
          </div>
        </div>

        <div className="p-4 sm:p-5">
          <PageTabs
            value={activeTab}
            onValueChange={(value) => {
              if (value === 'products') {
                navigate('/cmspanel/products');
              } else {
                navigate(`/cmspanel/products/${value}`);
              }
            }}
            tabs={tabs}
          >
            <TabsContent value="products" className="mt-0">
              <GenericContentManager
                tableName="products"
                resourceName={t('menu.products')}
                columns={productColumns}
                formFields={productFormFields}
                permissionPrefix="products"
                customSelect="*, category:categories(name), product_type:product_types(name), owner:users!created_by(email, full_name), tenant:tenants(name)"
                showBreadcrumbs={false}
                showHeader={false}
              />
            </TabsContent>

            <TabsContent value="types" className="mt-0">
              <GenericContentManager
                tableName="product_types"
                resourceName={t('menu.product_types')}
                columns={typeColumns}
                formFields={typeFormFields}
                permissionPrefix="product_types"
                showBreadcrumbs={false}
                showHeader={false}
              />
            </TabsContent>

            <TabsContent value="categories" className="mt-0">
              <GenericContentManager
                tableName="categories"
                resourceName={t('common.category')}
                columns={categoryColumns}
                formFields={categoryFormFields}
                permissionPrefix="categories"
                customSelect="*, owner:users!created_by(email, full_name), tenant:tenants(name)"
                defaultFilters={{ type: ['product', 'products'] }}
                showBreadcrumbs={false}
                showHeader={false}
                restorePermission="tenant.categories.restore"
                onSoftDeleteOverride={softDeleteCategory}
                onRestoreOverride={restoreCategory}
              />
            </TabsContent>
          </PageTabs>
        </div>
      </div>
    </AdminPageLayout>
  );
}

export default ProductsManager;
