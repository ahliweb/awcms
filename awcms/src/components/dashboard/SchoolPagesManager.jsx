import { useMemo } from 'react';
import { Building2 } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/components/ui/use-toast';
import SettingsPageShell from '@/components/dashboard/settings/SettingsPageShell';
import { useSettingsCollection } from '@/components/dashboard/settings/useSettingsManager';
import SchoolPagesTabs from '@/components/dashboard/school-pages/SchoolPagesTabs';
import { SCHOOL_PAGE_TABS, SETTINGS_KEYS } from '@/components/dashboard/school-pages/constants';

const DEFAULT_SCHOOL_PAGE_DATA = SCHOOL_PAGE_TABS.reduce((acc, tab) => {
  acc[tab.id] = {};
  return acc;
}, {});

function SchoolPagesManager() {
  const navigate = useNavigate();
  const { '*': splat } = useParams();
  const { toast } = useToast();
  const activeTab = SCHOOL_PAGE_TABS.some((tab) => tab.id === splat) ? splat : 'profile';

  const settings = useSettingsCollection({
    settingKeys: SETTINGS_KEYS,
    initialValue: DEFAULT_SCHOOL_PAGE_DATA,
  });

  const preSections = useMemo(
    () => [
      <Alert key="school-pages-warning">
        <AlertTitle>Legacy storage warning</AlertTitle>
        <AlertDescription>
          The School Pages surface now uses the canonical `school_pages` route, but the stored section records still use legacy `page_*` keys during the current transition window.
        </AlertDescription>
      </Alert>,
    ],
    []
  );

  const handleSave = async () => {
    try {
      await settings.save();
      toast({ title: 'Saved', description: 'School pages updated successfully.' });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Save failed', description: error.message });
    }
  };

  const handleReload = async () => {
    try {
      await settings.reload();
      toast({ title: 'Refreshed', description: 'School pages reloaded.' });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Reload failed', description: error.message });
    }
  };

  const updateField = (section, field, value) => {
    settings.updateField(section, field, value);
  };

  const updateTopLevel = (section, value) => {
    settings.updateSection(section, value);
  };

  return (
    <SettingsPageShell
      requiredPermission={['tenant.school_pages.read', 'platform.school_pages.read']}
      title="School Pages"
      description="Manage structured school profile content, organization data, and public information tabs."
      icon={Building2}
      breadcrumbs={[{ label: 'Settings' }, { label: 'School Pages', icon: Building2 }]}
      loading={settings.loading}
      onReload={handleReload}
      onSave={handleSave}
      saving={settings.saving}
      hasChanges={settings.hasChanges}
    >
      <div className="space-y-6">
        {preSections}

        <div className="rounded-2xl border border-border/60 bg-card/70 p-6 shadow-sm">
          <SchoolPagesTabs
            activeTab={activeTab}
            navigate={navigate}
            data={settings.value || DEFAULT_SCHOOL_PAGE_DATA}
            updateField={updateField}
            updateTopLevel={updateTopLevel}
          />
        </div>
      </div>
    </SettingsPageShell>
  );
}

export default SchoolPagesManager;
