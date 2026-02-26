import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { Loader2, Palette, Save } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useTenant } from '@/contexts/TenantContext';
import { usePermissions } from '@/contexts/PermissionContext';
import { useToast } from '@/components/ui/use-toast';
import { Form } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';
import TenantSettingsLoadingState from '@/components/dashboard/tenant-settings/TenantSettingsLoadingState';
import TenantSettingsErrorState from '@/components/dashboard/tenant-settings/TenantSettingsErrorState';
import TenantSettingsOverviewCards from '@/components/dashboard/tenant-settings/TenantSettingsOverviewCards';
import TenantBrandingFormCard from '@/components/dashboard/tenant-settings/TenantBrandingFormCard';

export default function TenantSettings() {
  const { t } = useTranslation();
  const { currentTenant: tenant, loading: tenantLoading } = useTenant();
  const { checkAccess } = usePermissions();
  const { toast } = useToast();
  const colorPickerId = useId();

  const [saving, setSaving] = useState(false);

  const canManageSettings = checkAccess('update', 'setting');

  const form = useForm({
    defaultValues: {
      brandColor: '#000000',
      fontFamily: 'Inter',
      logoUrl: '',
      siteName: '',
    },
  });

  useEffect(() => {
    if (!tenant) return;

    form.reset({
      brandColor: tenant.config?.theme?.brandColor || '#000000',
      fontFamily: tenant.config?.theme?.fontFamily || 'Inter',
      logoUrl: tenant.config?.theme?.logoUrl || '',
      siteName: tenant.config?.settings?.siteName || tenant.name || '',
    });
  }, [tenant, form]);

  const onSubmit = async (values) => {
    if (!tenant) return;

    setSaving(true);
    try {
      const newConfig = {
        ...tenant.config,
        theme: {
          brandColor: values.brandColor,
          fontFamily: values.fontFamily,
          logoUrl: values.logoUrl,
        },
        settings: {
          ...tenant.config?.settings,
          siteName: values.siteName,
        },
      };

      const { error } = await supabase
        .from('tenants')
        .update({
          config: newConfig,
          updated_at: new Date().toISOString(),
        })
        .eq('id', tenant.id);

      if (error) throw error;

      toast({
        title: t('tenant_settings.toasts.saved_title'),
        description: t('tenant_settings.toasts.saved_desc'),
      });
    } catch (error) {
      console.error('Error saving settings:', error);
      toast({
        variant: 'destructive',
        title: t('tenant_settings.toasts.error_title'),
        description: error.message,
      });
    } finally {
      setSaving(false);
    }
  };

  const watchedSiteName = form.watch('siteName');
  const watchedBrandColor = form.watch('brandColor');
  const watchedFontFamily = form.watch('fontFamily');

  if (tenantLoading) {
    return <TenantSettingsLoadingState />;
  }

  if (!tenant) {
    return (
      <TenantSettingsErrorState
        title={t('tenant_settings.errors.tenant_not_found')}
        description={t('tenant_settings.errors.tenant_load_error')}
      />
    );
  }

  if (!canManageSettings) {
    return (
      <TenantSettingsErrorState
        title={t('tenant_settings.errors.access_denied')}
        description={t('tenant_settings.errors.access_denied_desc')}
      />
    );
  }

  return (
    <AdminPageLayout>
      <PageHeader
        title={t('tenant_settings.title')}
        description={t('tenant_settings.description')}
        icon={Palette}
        breadcrumbs={[{ label: 'Settings' }, { label: 'Branding' }]}
      />

      <TenantSettingsOverviewCards
        tenant={tenant}
        watchedSiteName={watchedSiteName}
        watchedBrandColor={watchedBrandColor}
        watchedFontFamily={watchedFontFamily}
      />

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <TenantBrandingFormCard
            form={form}
            t={t}
            colorPickerId={colorPickerId}
          />

          <div className="flex justify-end">
            <Button type="submit" disabled={saving} className="h-10 rounded-xl bg-primary px-4 text-primary-foreground shadow-sm hover:opacity-95">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              {saving ? t('tenant_settings.buttons.saving') : t('tenant_settings.buttons.save_changes')}
            </Button>
          </div>
        </form>
      </Form>
    </AdminPageLayout>
  );
}
