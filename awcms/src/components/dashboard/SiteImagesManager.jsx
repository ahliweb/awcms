import { useMemo, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/components/ui/use-toast';
import SettingsPageShell from '@/components/dashboard/settings/SettingsPageShell';
import { useSettingsRecord } from '@/components/dashboard/settings/useSettingsManager';
import { SETTINGS_KEY } from '@/components/dashboard/site-images/constants';
import SiteImagesTabs from '@/components/dashboard/site-images/SiteImagesTabs';

function SiteImagesManager() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('hero');
  const settings = useSettingsRecord({
    settingKey: SETTINGS_KEY,
    initialValue: {
      hero: [],
      sections: {},
      gallery: [],
    },
  });

  const postSections = useMemo(
    () => [
      <Alert key="site-images-warning">
        <AlertTitle>Canonical resource path active</AlertTitle>
        <AlertDescription>
          Site Images now stays on the dedicated `site_images` admin surface while reusing the shared settings manager infrastructure.
        </AlertDescription>
      </Alert>,
    ],
    []
  );

  const handleSave = async () => {
    try {
      await settings.save();
      toast({ title: 'Saved', description: 'Site images saved successfully.' });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Save failed', description: error.message });
    }
  };

  const handleReload = async () => {
    try {
      await settings.reload();
      toast({ title: 'Refreshed', description: 'Site images reloaded.' });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Reload failed', description: error.message });
    }
  };

  const updateSection = (section, value) => {
    settings.setValue((prev) => ({
      ...(prev || {}),
      [section]: value,
    }));
  };

  return (
    <SettingsPageShell
      requiredPermission={['tenant.school_pages.read', 'platform.school_pages.read']}
      title="Site Images"
      description="Manage hero images, section visuals, and gallery collections for the public site."
      icon={ImageIcon}
      breadcrumbs={[{ label: 'Settings' }, { label: 'Site Images', icon: ImageIcon }]}
      loading={settings.loading}
      onReload={handleReload}
      onSave={handleSave}
      saving={settings.saving}
      hasChanges={settings.hasChanges}
    >
      <div className="space-y-6">
        {postSections}

        <div className="rounded-2xl border border-border/60 bg-card/70 p-6 shadow-sm">
          <SiteImagesTabs
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            data={settings.value || {}}
            updateSection={updateSection}
          />
        </div>
      </div>
    </SettingsPageShell>
  );
}

export default SiteImagesManager;
