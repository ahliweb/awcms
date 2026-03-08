import { useMemo } from 'react';
import { Settings } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/components/ui/use-toast';
import SettingsFormRenderer from '@/components/dashboard/settings/SettingsFormRenderer';
import SettingsPageShell from '@/components/dashboard/settings/SettingsPageShell';
import { useSettingsRecord } from '@/components/dashboard/settings/useSettingsManager';

const GENERAL_SETTINGS_SCHEMA = {
  slots: {
    before: [
      {
        type: 'alert',
        title: 'General tenant defaults',
        description: 'These settings define the default site identity and maintenance messaging used by the tenant experience.',
      },
    ],
  },
  fields: [
    {
      name: 'site_name',
      label: 'Site Name',
      placeholder: 'Enter the public site name',
      description: 'Used as the default name across admin and public surfaces.',
    },
    {
      name: 'site_tagline',
      label: 'Tagline',
      placeholder: 'Describe the tenant in a short phrase',
    },
    {
      name: 'contact_email',
      label: 'Contact Email',
      inputType: 'email',
      placeholder: 'admin@example.com',
    },
    {
      name: 'contact_phone',
      label: 'Contact Phone',
      placeholder: '+62...',
    },
    {
      name: 'maintenance_mode',
      label: 'Maintenance Mode',
      inputType: 'boolean',
      toggleLabel: 'Enable maintenance mode',
      helpText: 'When enabled, public clients can display a maintenance message.',
      fullWidth: true,
    },
    {
      name: 'maintenance_message',
      label: 'Maintenance Message',
      inputType: 'textarea',
      placeholder: 'We are performing scheduled maintenance. Please check back soon.',
      fullWidth: true,
    },
  ],
};

function SettingsManager() {
  const { toast } = useToast();
  const settings = useSettingsRecord({
    settingKey: 'site_info',
    initialValue: {
      site_name: '',
      site_tagline: '',
      contact_email: '',
      contact_phone: '',
      maintenance_mode: false,
      maintenance_message: '',
    },
  });

  const postSections = useMemo(
    () => [
      <Alert key="settings-general-note">
        <AlertTitle>Canonical general-settings surface</AlertTitle>
        <AlertDescription>
          {'settings_general now edits the curated site_info record instead of exposing the raw settings key/value table.'}
        </AlertDescription>
      </Alert>,
    ],
    []
  );

  const handleSave = async () => {
    try {
      await settings.save();
      toast({ title: 'Saved', description: 'General settings updated successfully.' });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Save failed', description: error.message });
    }
  };

  const handleReload = async () => {
    try {
      await settings.reload();
      toast({ title: 'Refreshed', description: 'General settings reloaded.' });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Reload failed', description: error.message });
    }
  };

  return (
    <SettingsPageShell
      requiredPermission="tenant.setting.read"
      title="General Settings"
      description="Manage tenant-wide identity, contact, and maintenance defaults."
      icon={Settings}
      breadcrumbs={[{ label: 'Settings' }, { label: 'General Settings', icon: Settings }]}
      loading={settings.loading}
      onReload={handleReload}
      onSave={handleSave}
      saving={settings.saving}
      hasChanges={settings.hasChanges}
    >
      <SettingsFormRenderer
        schema={GENERAL_SETTINGS_SCHEMA}
        value={settings.value}
        onChange={settings.setValue}
        disabled={settings.saving}
        postSections={postSections}
      />
    </SettingsPageShell>
  );
}

export default SettingsManager;
