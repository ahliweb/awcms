
import React from 'react';
import GenericContentManager from '@/components/dashboard/GenericContentManager';
import { Layers } from 'lucide-react';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';

function ProductTypesManager() {
  const columns = [
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
    {
      key: 'description',
      label: 'Description',
      render: (val) => val ? (
        <span className="text-slate-600 line-clamp-1 max-w-[300px]">{val}</span>
      ) : (
        <span className="text-slate-300">-</span>
      )
    },
    {
      key: 'tags',
      label: 'Tags',
      render: (val) => val && val.length > 0 ? (
        <div className="flex gap-1 flex-wrap">
          {val.slice(0, 3).map((tag, i) => (
            <span key={i} className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full text-xs">
              {tag}
            </span>
          ))}
          {val.length > 3 && (
            <span className="text-xs text-slate-400">+{val.length - 3}</span>
          )}
        </div>
      ) : (
        <span className="text-slate-300">-</span>
      )
    },
    { key: 'created_at', label: 'Created', type: 'date' }
  ];

  const formFields = [
    { key: 'name', label: 'Type Name', required: true, description: 'E.g., Electronics, Clothing, Food' },
    { key: 'slug', label: 'Slug', required: true, description: 'URL-friendly identifier' },
    { key: 'description', label: 'Description', type: 'textarea', description: 'Brief description of this product type' },
    { key: 'icon', label: 'Icon', description: 'Emoji or image URL' },
    { key: 'tags', label: 'Tags', type: 'tags', description: 'Keywords for filtering and search' }
  ];

  return (
    <AdminPageLayout requiredPermission="tenant.product_types.read">
      <PageHeader
        title="Product Types"
        description="Define product categories and classification types."
        icon={Layers}
        breadcrumbs={[{ label: 'Product Types', icon: Layers }]}
      />

      <GenericContentManager
        tableName="product_types"
        resourceName="Product Type"
        columns={columns}
        formFields={formFields}
        permissionPrefix="product_types"
        showBreadcrumbs={false}
      />
    </AdminPageLayout>
  );
}

export default ProductTypesManager;
