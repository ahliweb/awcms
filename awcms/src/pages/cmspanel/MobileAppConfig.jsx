import { Smartphone } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import SettingsFormRenderer from '@/components/dashboard/settings/SettingsFormRenderer';
import SettingsPageShell from '@/components/dashboard/settings/SettingsPageShell';
import { useSettingsRecord } from '@/components/dashboard/settings/useSettingsManager';

const MOBILE_CONFIG_SCHEMA = {
  fields: [
    { name: 'app_name', label: 'App Name', placeholder: 'AWCMS Mobile' },
    { name: 'app_logo_url', label: 'Logo URL', inputType: 'url', placeholder: 'https://...' },
    { name: 'primary_color', label: 'Primary Color', inputType: 'color' },
    { name: 'secondary_color', label: 'Secondary Color', inputType: 'color' },
    { name: 'force_update_version', label: 'Force Update Version', placeholder: '1.0.0' },
    { name: 'recommended_version', label: 'Recommended Version', placeholder: '1.1.0' },
    {
      name: 'maintenance_mode',
      label: 'Maintenance Mode',
      inputType: 'boolean',
      toggleLabel: 'Enable mobile maintenance mode',
      helpText: 'When enabled, mobile clients should show the maintenance wall.',
      fullWidth: true,
    },
    {
      name: 'maintenance_message',
      label: 'Maintenance Message',
      inputType: 'textarea',
      placeholder: 'The mobile app is temporarily unavailable while we perform maintenance.',
      fullWidth: true,
    },
  ],
};

function MobileAppConfig() {
  const { user } = useAuth();
  const { toast } = useToast();
  const settings = useSettingsRecord({
    settingKey: 'mobile_config',
    initialValue: {
      app_name: '',
      app_logo_url: '',
      primary_color: '#3b82f6',
      secondary_color: '#10b981',
      force_update_version: '',
      recommended_version: '',
      maintenance_mode: false,
      maintenance_message: '',
    },
    loadRecord: async ({ tenantId, supabase, initialValue }) => {
      const { data, error } = await supabase
        .from('mobile_app_config')
        .select('*')
        .eq('tenant_id', tenantId)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      return data ? { ...initialValue, ...data } : initialValue;
    },
    saveRecord: async ({ tenantId, value, supabase }) => {
      const { error } = await supabase.from('mobile_app_config').upsert({
        ...value,
        tenant_id: tenantId,
        updated_by: user?.id,
      });

      if (error) throw error;
    },
  });

  const handleSave = async () => {
    try {
      await settings.save();
      toast({ title: 'Saved', description: 'Mobile app configuration saved successfully.' });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Save failed', description: error.message });
    }
  };

  const handleReload = async () => {
    try {
      await settings.reload();
      toast({ title: 'Refreshed', description: 'Mobile configuration reloaded.' });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Reload failed', description: error.message });
    }
  };

  return (
    <SettingsPageShell
      requiredPermission="tenant.mobile.update"
      title="App Config"
      description="Manage tenant-specific mobile branding, update policy, and maintenance behavior."
      icon={Smartphone}
      breadcrumbs={[{ label: 'Settings' }, { label: 'Mobile App Config', icon: Smartphone }]}
      loading={settings.loading}
      onReload={handleReload}
      onSave={handleSave}
      saving={settings.saving}
      hasChanges={settings.hasChanges}
    >
      <SettingsFormRenderer
        schema={MOBILE_CONFIG_SCHEMA}
        value={settings.value}
        onChange={settings.setValue}
        disabled={settings.saving}
        preSections={[
          <Alert key="mobile-config-warning">
            <AlertTitle>Legacy backing store warning</AlertTitle>
            <AlertDescription>
              This canonical `mobile_config` surface still persists to the `mobile_app_config` table during the current transition window.
            </AlertDescription>
          </Alert>,
        ]}
      />
    </SettingsPageShell>
  );
}

export default MobileAppConfig;
