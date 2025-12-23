
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import GenericContentManager from '@/components/dashboard/GenericContentManager';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Package, Layers, ChevronRight, Home, FolderOpen } from 'lucide-react';

function ProductsManager() {
  const [activeTab, setActiveTab] = useState('products');

  // Product columns
  const productColumns = [
    {
      key: 'featured_image',
      label: '',
      className: 'w-16',
      render: (val) => val ? (
        <img src={val} alt="" className="w-12 h-12 object-cover rounded-lg border" />
      ) : (
        <div className="w-12 h-12 bg-slate-100 rounded-lg flex items-center justify-center">
          <Package className="w-6 h-6 text-slate-300" />
        </div>
      )
    },
    { key: 'name', label: 'Product Name', className: 'font-medium' },
    {
      key: 'sku',
      label: 'SKU',
      className: 'font-mono text-xs text-slate-500',
      render: (val) => val || <span className="text-slate-300">-</span>
    },
    {
      key: 'price',
      label: 'Price',
      render: (val, row) => (
        <div className="flex flex-col">
          {row.discount_price && row.discount_price < val ? (
            <>
              <span className="text-green-600 font-semibold">
                {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(row.discount_price)}
              </span>
              <span className="text-xs text-slate-400 line-through">
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
      label: 'Stock',
      render: (val) => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${val > 10 ? 'bg-green-100 text-green-700' :
          val > 0 ? 'bg-amber-100 text-amber-700' :
            'bg-red-100 text-red-700'
          }`}>
          {val > 0 ? val : 'Out of Stock'}
        </span>
      )
    },
    {
      key: 'status',
      label: 'Status',
      render: (value) => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${value === 'active' ? 'bg-green-100 text-green-700' :
          value === 'out_of_stock' ? 'bg-red-100 text-red-700' :
            value === 'draft' ? 'bg-amber-100 text-amber-700' :
              'bg-slate-100 text-slate-600'
          }`}>
          {value?.replace(/_/g, ' ') || 'draft'}
        </span>
      )
    }
  ];

  const productFormFields = [
    { key: 'name', label: 'Product Name', required: true, description: 'Display name for the product' },
    { key: 'slug', label: 'Slug', description: 'URL-friendly name (auto-generated if empty)' },
    { key: 'sku', label: 'SKU', description: 'Stock Keeping Unit - unique product identifier' },
    { key: 'price', label: 'Price (IDR)', type: 'number', required: true },
    { key: 'discount_price', label: 'Discount Price (IDR)', type: 'number', description: 'Sale price (leave empty if no discount)' },
    { key: 'stock', label: 'Stock Quantity', type: 'number', description: 'Available inventory count' },
    { key: 'is_available', label: 'Available for Purchase', type: 'boolean', description: 'Toggle product availability' },
    { key: 'shipping_cost', label: 'Shipping Cost (IDR)', type: 'number', description: 'Standard shipping cost' },
    { key: 'weight', label: 'Weight (kg)', type: 'number', description: 'Product weight for shipping calculation' },
    { key: 'dimensions', label: 'Dimensions', description: 'L x W x H in cm (e.g., 30x20x10)' },
    { key: 'featured_image', label: 'Main Image', type: 'image', description: 'Product cover/thumbnail' },
    { key: 'images', label: 'Gallery', type: 'images', description: 'Additional product images', maxImages: 10 },
    { key: 'description', label: 'Description', type: 'richtext' },
    { key: 'category_id', label: 'Category', type: 'relation', table: 'categories', filter: { type: 'product' } },
    { key: 'product_type_id', label: 'Product Type', type: 'relation', table: 'product_types', description: 'Specific type/brand/collection' },
    { key: 'tags', label: 'Tags', type: 'tags' },
    { key: 'published_at', label: 'Launch Date', type: 'datetime' },
    {
      key: 'status', label: 'Status', type: 'select', options: [
        { value: 'draft', label: 'Draft' },
        { value: 'active', label: 'Active' },
        { value: 'out_of_stock', label: 'Out of Stock' },
        { value: 'archived', label: 'Archived' }
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
        <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center text-lg">
          {val.startsWith('http') ? (
            <img src={val} alt="" className="w-6 h-6 object-contain" />
          ) : (
            val
          )}
        </div>
      ) : (
        <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center">
          <Layers className="w-5 h-5 text-slate-400" />
        </div>
      )
    },
    { key: 'name', label: 'Type Name', className: 'font-medium' },
    { key: 'slug', label: 'Slug', className: 'font-mono text-xs text-slate-500' },
    { key: 'created_at', label: 'Created', type: 'date' }
  ];

  const typeFormFields = [
    { key: 'name', label: 'Type Name', required: true, description: 'E.g., Electronics, Clothing, Food' },
    { key: 'slug', label: 'Slug', required: true, description: 'URL-friendly identifier' },
    { key: 'description', label: 'Description', type: 'textarea', description: 'Brief description of this product type' },
    { key: 'icon', label: 'Icon', description: 'Emoji or image URL' },
    { key: 'tags', label: 'Tags', type: 'tags', description: 'Keywords for filtering and search' }
  ];

  // Category columns for products
  const categoryColumns = [
    { key: 'name', label: 'Name', className: 'font-medium' },
    { key: 'slug', label: 'Slug' },
    { key: 'description', label: 'Description' },
    { key: 'created_at', label: 'Created', type: 'date' }
  ];

  const categoryFormFields = [
    { key: 'name', label: 'Category Name', required: true },
    { key: 'slug', label: 'Slug' },
    { key: 'description', label: 'Description', type: 'textarea' },
    { key: 'type', label: 'Type', type: 'hidden', defaultValue: 'product' }
  ];

  return (
    <div className="space-y-6">
      {/* Breadcrumb Navigation */}
      <nav className="flex items-center text-sm text-slate-500">
        <Link to="/cmspanel" className="hover:text-blue-600 transition-colors flex items-center gap-1">
          <Home className="w-4 h-4" />
          Dashboard
        </Link>
        <ChevronRight className="w-4 h-4 mx-2 text-slate-300" />
        <span className="flex items-center gap-1 text-slate-700 font-medium">
          <Package className="w-4 h-4" />
          Products
        </span>
        {activeTab !== 'products' && (
          <>
            <ChevronRight className="w-4 h-4 mx-2 text-slate-300" />
            <span className="text-blue-600 font-medium capitalize">{activeTab.replace('_', ' ')}</span>
          </>
        )}
      </nav>

      {/* Enhanced Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <div className="bg-white rounded-xl border border-slate-200 p-1.5 shadow-sm mb-6 inline-flex">
          <TabsList className="grid grid-cols-3 gap-1 bg-transparent p-0">
            <TabsTrigger
              value="products"
              className="flex items-center gap-2 px-6 py-2.5 rounded-lg data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-600 data-[state=active]:to-blue-700 data-[state=active]:text-white data-[state=active]:shadow-md transition-all duration-200 font-medium"
            >
              <Package className="w-4 h-4" />
              Products
            </TabsTrigger>
            <TabsTrigger
              value="types"
              className="flex items-center gap-2 px-6 py-2.5 rounded-lg data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-600 data-[state=active]:to-purple-700 data-[state=active]:text-white data-[state=active]:shadow-md transition-all duration-200 font-medium"
            >
              <Layers className="w-4 h-4" />
              Types
            </TabsTrigger>
            <TabsTrigger
              value="categories"
              className="flex items-center gap-2 px-6 py-2.5 rounded-lg data-[state=active]:bg-gradient-to-r data-[state=active]:from-emerald-600 data-[state=active]:to-emerald-700 data-[state=active]:text-white data-[state=active]:shadow-md transition-all duration-200 font-medium"
            >
              <FolderOpen className="w-4 h-4" />
              Categories
            </TabsTrigger>
          </TabsList>
        </div>
      </Tabs>

      {/* Tab Content */}
      {activeTab === 'products' && (
        <GenericContentManager
          tableName="products"
          resourceName="Product"
          columns={productColumns}
          formFields={productFormFields}
          permissionPrefix="products"
          customSelect="*, category:categories(name), product_type:product_types(name)"
          showBreadcrumbs={false}
        />
      )}

      {activeTab === 'types' && (
        <GenericContentManager
          tableName="product_types"
          resourceName="Product Type"
          columns={typeColumns}
          formFields={typeFormFields}
          permissionPrefix="product_types"
          showBreadcrumbs={false}
        />
      )}

      {activeTab === 'categories' && (
        <GenericContentManager
          tableName="categories"
          resourceName="Category"
          columns={categoryColumns}
          formFields={categoryFormFields}
          permissionPrefix="categories"
          customSelect="*"
          defaultFilters={{ type: 'product' }}
          showBreadcrumbs={false}
        />
      )}
    </div>
  );
}

export default ProductsManager;
