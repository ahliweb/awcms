
import React from 'react';
import GenericContentManager from '@/components/dashboard/GenericContentManager';

function CategoriesManager() {
  const columns = [
    { key: 'name', label: 'Name', className: 'font-medium' },
    { key: 'slug', label: 'Slug' },
    { key: 'type', label: 'Type' }
  ];

  const formFields = [
    { key: 'name', label: 'Category Name', required: true },
    { key: 'slug', label: 'Slug' },
    { key: 'description', label: 'Description', type: 'textarea' },
    {
      key: 'type', label: 'Type', type: 'select', options: [
        { value: 'article', label: 'Article Category' },
        { value: 'page', label: 'Page Category' },
        { value: 'product', label: 'Product Category' },
        { value: 'portfolio', label: 'Portfolio Category' },
        { value: 'testimony', label: 'Testimony Category' },
        { value: 'announcement', label: 'Announcement Category' },
        { value: 'promotion', label: 'Promotion Category' },
        { value: 'photo_gallery', label: 'Photo Gallery Category' },
        { value: 'video_gallery', label: 'Video Gallery Category' },
        { value: 'gallery', label: 'General Gallery' }
      ]
    }
  ];

  return (
    <GenericContentManager
      tableName="categories"
      resourceName="Category"
      columns={columns}
      formFields={formFields}
      permissionPrefix="categories"

    />
  );
}

export default CategoriesManager;
