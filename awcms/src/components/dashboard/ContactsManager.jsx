import { useState, useEffect } from 'react';
import GenericContentManager from '@/components/dashboard/GenericContentManager';
import { supabase } from '@/lib/customSupabaseClient';
import { MapPin } from 'lucide-react';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';

function ContactsManager() {
  const [provinces, setProvinces] = useState([]);

  useEffect(() => {
    const fetchProvinces = async () => {
      const { data } = await supabase.from('provinces').select('id, name').order('name');
      if (data) setProvinces(data);
    };
    fetchProvinces();
  }, []);

  const columns = [
    { key: 'name', label: 'Location Name' },
    { key: 'city', label: 'City' },
    { key: 'phone', label: 'Phone' },
    { key: 'email', label: 'Email' }
  ];

  const formFields = [
    { key: 'name', label: 'Location Name', required: true, description: 'e.g. Head Office' },
    { key: 'address', label: 'Address', type: 'textarea', required: true },
    { key: 'city', label: 'City', required: true },
    {
      key: 'province',
      label: 'Province',
      type: 'select',
      options: provinces.map(p => ({ value: p.name, label: p.name })),
      required: true
    },
    { key: 'postal_code', label: 'Postal Code' },
    { key: 'country', label: 'Country', defaultValue: 'Indonesia' },
    { key: 'phone', label: 'Phone Number' },
    { key: 'email', label: 'Email Address' },
    { key: 'latitude', label: 'Latitude', type: 'number', description: 'e.g. -6.2088' },
    { key: 'longitude', label: 'Longitude', type: 'number', description: 'e.g. 106.8456' },
    { key: 'website', label: 'Website URL' },
    { key: 'description', label: 'Description/Notes', type: 'textarea' },
    { key: 'category_id', label: 'Category', type: 'relation', table: 'categories', filter: { type: 'contact' } }
  ];

  return (
    <AdminPageLayout requiredPermission="tenant.contacts.read">
      <PageHeader
        title="Locations"
        description="Manage office locations and contact information."
        icon={MapPin}
        breadcrumbs={[{ label: 'Locations', icon: MapPin }]}
      />

      <GenericContentManager
        tableName="contacts"
        resourceName="Location"
        columns={columns}
        formFields={formFields}
        permissionPrefix="contacts"
        showBreadcrumbs={false}
      />
    </AdminPageLayout>
  );
}

export default ContactsManager;
