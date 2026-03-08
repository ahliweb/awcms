import { Globe } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/components/ui/use-toast';
import SettingsFormRenderer from '@/components/dashboard/settings/SettingsFormRenderer';
import SettingsPageShell from '@/components/dashboard/settings/SettingsPageShell';
import { useSettingsRecord } from '@/components/dashboard/settings/useSettingsManager';

const SEO_SCHEMA = {
  fields: [
    { name: 'meta_title', label: 'Meta Title', placeholder: 'Site title used in search results' },
    {
      name: 'meta_description',
      label: 'Meta Description',
      inputType: 'textarea',
      placeholder: 'Describe the tenant for search engines and social previews.',
      fullWidth: true,
    },
    { name: 'meta_keywords', label: 'Meta Keywords', placeholder: 'cms, school, education' },
    { name: 'og_image', label: 'Open Graph Image', inputType: 'url', placeholder: 'https://...' },
    { name: 'canonical_url', label: 'Canonical URL', inputType: 'url', placeholder: 'https://example.com' },
    {
      name: 'robots',
      label: 'Robots Directive',
      inputType: 'select',
      options: [
        { value: 'index, follow', label: 'index, follow' },
        { value: 'noindex, follow', label: 'noindex, follow' },
        { value: 'noindex, nofollow', label: 'noindex, nofollow' },
      ],
    },
  ],
};

function SeoManager() {
  const { toast } = useToast();
  const settings = useSettingsRecord({
    settingKey: 'seo_global',
    initialValue: {
      meta_title: '',
      meta_description: '',
      meta_keywords: '',
      og_image: '',
      canonical_url: '',
      robots: 'index, follow',
    },
    loadRecord: async ({ tenantId, initialValue, supabase }) => {
      const { data: seoRow, error: seoError } = await supabase
        .from('seo_metadata')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('resource_type', 'site')
        .is('resource_id', null)
        .maybeSingle();

      if (seoError) throw seoError;
      if (seoRow) return { ...initialValue, ...seoRow };

      const { data: fallbackRow, error: fallbackError } = await supabase
        .from('settings')
        .select('value')
        .eq('tenant_id', tenantId)
        .eq('key', 'seo_global')
        .is('deleted_at', null)
        .maybeSingle();

      if (fallbackError) throw fallbackError;

      if (!fallbackRow?.value) return initialValue;

      const fallbackValue = typeof fallbackRow.value === 'string'
        ? JSON.parse(fallbackRow.value)
        : fallbackRow.value;

      return {
        ...initialValue,
        meta_title: fallbackValue.site_title || '',
        meta_description: fallbackValue.site_description || '',
        meta_keywords: fallbackValue.default_keywords || '',
        og_image: fallbackValue.og_image || '',
        canonical_url: fallbackValue.canonical_url || '',
        robots: fallbackValue.robots || 'index, follow',
      };
    },
    saveRecord: async ({ tenantId, value, supabase }) => {
      const payload = {
        tenant_id: tenantId,
        resource_type: 'site',
        resource_id: null,
        meta_title: value.meta_title,
        meta_description: value.meta_description,
        meta_keywords: value.meta_keywords,
        og_image: value.og_image,
        canonical_url: value.canonical_url,
        robots: value.robots,
      };

      const { data: existingRow, error: existingError } = await supabase
        .from('seo_metadata')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('resource_type', 'site')
        .is('resource_id', null)
        .maybeSingle();

      if (existingError) throw existingError;

      const query = existingRow?.id
        ? supabase.from('seo_metadata').update(payload).eq('id', existingRow.id)
        : supabase.from('seo_metadata').insert(payload);

      const { error } = await query;
      if (error) throw error;

      const legacyPayload = {
        site_title: value.meta_title,
        site_description: value.meta_description,
        default_keywords: value.meta_keywords,
        og_image: value.og_image,
        canonical_url: value.canonical_url,
        robots: value.robots,
      };

      const { error: legacyError } = await supabase.from('settings').upsert(
        {
          tenant_id: tenantId,
          key: 'seo_global',
          value: JSON.stringify(legacyPayload),
          type: 'json',
          deleted_at: null,
        },
        { onConflict: 'tenant_id,key' }
      );

      if (legacyError) throw legacyError;
    },
  });

  const handleSave = async () => {
    try {
      await settings.save();
      toast({ title: 'Saved', description: 'SEO defaults updated successfully.' });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Save failed', description: error.message });
    }
  };

  const handleReload = async () => {
    try {
      await settings.reload();
      toast({ title: 'Refreshed', description: 'SEO defaults reloaded.' });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Reload failed', description: error.message });
    }
  };

  return (
    <SettingsPageShell
      requiredPermission="tenant.seo.read"
      title="SEO Manager"
      description="Manage default metadata and crawler directives for the tenant experience."
      icon={Globe}
      breadcrumbs={[{ label: 'Settings' }, { label: 'SEO Manager', icon: Globe }]}
      loading={settings.loading}
      onReload={handleReload}
      onSave={handleSave}
      saving={settings.saving}
      hasChanges={settings.hasChanges}
    >
      <SettingsFormRenderer
        schema={SEO_SCHEMA}
        value={settings.value}
        onChange={settings.setValue}
        disabled={settings.saving}
        preSections={[
          <Alert key="seo-warning">
            <AlertTitle>Compatibility sync active</AlertTitle>
            <AlertDescription>
              This screen now treats `seo_metadata` as the canonical store and also syncs the legacy `seo_global` settings payload for public consumers during the transition window.
            </AlertDescription>
          </Alert>,
        ]}
      />
    </SettingsPageShell>
  );
}

export default SeoManager;
