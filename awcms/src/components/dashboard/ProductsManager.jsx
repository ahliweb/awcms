
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import GenericContentManager from '@/components/dashboard/GenericContentManager';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Package, Layers, FolderOpen } from 'lucide-react';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';

function ProductsManager() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('products');

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
              <span className="text-green-600 font-semibold dark:text-green-400">
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
      render: (val) => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${val > 10 ? 'bg-green-100 text-green-700' :
          val > 0 ? 'bg-amber-100 text-amber-700' :
            'bg-red-100 text-red-700'
          }`}>
          {val > 0 ? val : t('products.out_of_stock')}
        </span>
      )
    },
    {
      key: 'status',
      label: t('common.status'),
      render: (value) => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${value === 'active' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
          value === 'out_of_stock' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
            value === 'draft' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
              'bg-muted text-muted-foreground'
          }`}>
          {value ? t(`products.status_options.${value}`) : t('common.draft')}
        </span>
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
    { key: 'category_id', label: t('common.category'), type: 'relation', table: 'categories', filter: { type: 'product' } },
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

  // Breadcrumbs for PageHeader
  const breadcrumbs = [
    { label: t('menu.products'), icon: Package },
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

      {/* Enhanced Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <div className="bg-muted/50 rounded-xl border border-border p-1.5 shadow-sm mb-6 inline-flex">
          <TabsList className="grid grid-cols-3 gap-1 bg-transparent p-0">
            <TabsTrigger
              value="products"
              className="flex items-center gap-2 px-6 py-2.5 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md transition-all duration-200 font-medium"
            >
              <Package className="w-4 h-4" />
              {t('menu.products')}
            </TabsTrigger>
            <TabsTrigger
              value="types"
              className="flex items-center gap-2 px-6 py-2.5 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md transition-all duration-200 font-medium"
            >
              <Layers className="w-4 h-4" />
              {t('menu.product_types')}
            </TabsTrigger>
            <TabsTrigger
              value="categories"
              className="flex items-center gap-2 px-6 py-2.5 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md transition-all duration-200 font-medium"
            >
              <FolderOpen className="w-4 h-4" />
              {t('menu.categories')}
            </TabsTrigger>
          </TabsList>
        </div>
      </Tabs>

      {/* Tab Content */}
      {activeTab === 'products' && (
        <GenericContentManager
          tableName="products"
          resourceName={t('menu.products')}
          columns={productColumns}
          formFields={productFormFields}
          permissionPrefix="products"
          customSelect="*, category:categories(name), product_type:product_types(name), owner:users!created_by(email, full_name), tenant:tenants(name)"
          showBreadcrumbs={false}
        />
      )}

      {activeTab === 'types' && (
        <GenericContentManager
          tableName="product_types"
          resourceName={t('menu.product_types')}
          columns={typeColumns}
          formFields={typeFormFields}
          permissionPrefix="product_types"
          showBreadcrumbs={false}
        />
      )}

      {activeTab === 'categories' && (
        <GenericContentManager
          tableName="categories"
          resourceName={t('common.category')}
          columns={categoryColumns}
          formFields={categoryFormFields}
          permissionPrefix="categories"
          customSelect="*, owner:users!created_by(email, full_name), tenant:tenants(name)"
          defaultFilters={{ type: 'product' }}
          showBreadcrumbs={false}
        />
      )}
    </AdminPageLayout>
  );
}

export default ProductsManager;
