import { Building2 } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import SettingsPageShell from '@/components/dashboard/settings/SettingsPageShell';
import { useSettingsCollection } from '@/components/dashboard/settings/useSettingsManager';
import SchoolPagesTabs from '@/components/dashboard/school-pages/SchoolPagesTabs';
import { SCHOOL_PAGE_TABS, SETTINGS_KEYS } from '@/components/dashboard/school-pages/constants';
import { triggerPublicRebuild } from '@/lib/publicRebuild';
import { useTenant } from '@/contexts/TenantContext';

const DEFAULT_SCHOOL_PAGE_DATA = SCHOOL_PAGE_TABS.reduce((acc, tab) => {
  acc[tab.id] = {};
  return acc;
}, {});

function SchoolPagesManager() {
  const navigate = useNavigate();
  const { '*': splat } = useParams();
  const { toast } = useToast();
  const { currentTenant } = useTenant();
  const activeTab = SCHOOL_PAGE_TABS.some((tab) => tab.id === splat) ? splat : 'profile';

  const settings = useSettingsCollection({
    settingKeys: SETTINGS_KEYS,
    initialValue: DEFAULT_SCHOOL_PAGE_DATA,
  });

  const handleSave = async () => {
    try {
      await settings.save();
      toast({ title: 'Saved', description: 'School pages updated successfully.' });
      
      // Auto-deploy after saving
      try {
        if (currentTenant?.id) {
          await triggerPublicRebuild({
            tenantId: currentTenant.id,
            resource: 'school_pages',
            action: 'update',
          });
        }
      } catch (rebuildError) {
        console.warn('Public rebuild trigger failed:', rebuildError);
      }
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

  const handleDeploy = async () => {
    try {
      if (currentTenant?.id) {
        await triggerPublicRebuild({
          tenantId: currentTenant.id,
          resource: 'school_pages',
          action: 'deploy',
        });
        toast({ 
          title: 'Deployment Triggered', 
          description: 'The public site rebuild process has been initiated successfully.' 
        });
      } else {
        throw new Error('No active tenant context found.');
      }
    } catch (error) {
      toast({ variant: 'destructive', title: 'Deploy failed', description: error.message || 'Failed to trigger rebuild.' });
    }
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
      actions={
        <Button onClick={handleDeploy} variant="secondary">
          Deploy to Public
        </Button>
      }
    >
      <div className="rounded-2xl border border-border/60 bg-card/70 p-6 shadow-sm">
        <SchoolPagesTabs
          activeTab={activeTab}
          navigate={navigate}
          data={settings.value || DEFAULT_SCHOOL_PAGE_DATA}
          updateField={settings.updateField}
          updateSection={settings.updateSection}
        />
      </div>
    </SettingsPageShell>
  );
}

export default SchoolPagesManager;
