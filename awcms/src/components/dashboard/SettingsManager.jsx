import { Settings } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import SettingsFormRenderer from '@/components/dashboard/settings/SettingsFormRenderer';
import SettingsPageShell from '@/components/dashboard/settings/SettingsPageShell';
import { useSettingsRecord } from '@/components/dashboard/settings/useSettingsManager';
import { triggerPublicRebuild } from '@/lib/publicRebuild';

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
      name: 'primary_cta_label',
      label: 'Primary Header CTA Label',
      placeholder: 'Get Started',
    },
    {
      name: 'primary_cta_url',
      label: 'Primary Header CTA URL',
      inputType: 'url',
      placeholder: 'https://example.com/signup',
    },
    {
      name: 'social_twitter',
      label: 'Twitter/X URL',
      inputType: 'url',
      placeholder: 'https://twitter.com/yourtenant',
    },
    {
      name: 'social_instagram',
      label: 'Instagram URL',
      inputType: 'url',
      placeholder: 'https://instagram.com/yourtenant',
    },
    {
      name: 'social_facebook',
      label: 'Facebook URL',
      inputType: 'url',
      placeholder: 'https://facebook.com/yourtenant',
    },
    {
      name: 'social_youtube',
      label: 'YouTube URL',
      inputType: 'url',
      placeholder: 'https://youtube.com/@yourtenant',
    },
    {
      name: 'header_actions_json',
      label: 'Header Actions JSON',
      inputType: 'textarea',
      placeholder: '[{"text":"Apply Now","href":"https://example.com/apply","target":"_blank"}]',
      description: 'Optional JSON array of public header actions. When present, this overrides the single primary CTA fields.',
      fullWidth: true,
    },
    {
      name: 'footer_columns_json',
      label: 'Footer Columns JSON',
      inputType: 'textarea',
      placeholder: '[{"title":"Company","links":[{"text":"About","href":"/about"}]}]',
      description: 'Optional JSON array for fallback footer columns when tenant-authored footer menus are not available.',
      fullWidth: true,
    },
    {
      name: 'footer_secondary_links_json',
      label: 'Footer Secondary Links JSON',
      inputType: 'textarea',
      placeholder: '[{"text":"Terms","href":"/p/terms","target":"_blank","popup":true}]',
      description: 'Optional JSON array for policy/contact links shown beside the footer brand block.',
      fullWidth: true,
    },
    {
      name: 'social_links_json',
      label: 'Social Links JSON',
      inputType: 'textarea',
      placeholder: '[{"ariaLabel":"Instagram","icon":"tabler:brand-instagram","href":"https://instagram.com/yourtenant"}]',
      description: 'Optional JSON array for footer social links. When present, this overrides the individual social URL fields.',
      fullWidth: true,
    },
    {
      name: 'footer_footnote',
      label: 'Footer Footnote',
      placeholder: 'Built for your community.',
      description: 'Optional custom footer footnote text.',
      fullWidth: true,
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
      primary_cta_label: '',
      primary_cta_url: '',
      social_twitter: '',
      social_instagram: '',
      social_facebook: '',
      social_youtube: '',
      header_actions_json: '',
      footer_columns_json: '',
      footer_secondary_links_json: '',
      social_links_json: '',
      footer_footnote: '',
      maintenance_mode: false,
      maintenance_message: '',
    },
  });

  const handleSave = async () => {
    try {
      await settings.save();
      await triggerPublicRebuild({ tenantId: settings.tenantId, resource: 'site_info', action: 'update' });
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
      />
    </SettingsPageShell>
  );
}

export default SettingsManager;
