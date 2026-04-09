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
import { AdminPageLayout, PageHeader } from '@/templates/emdash-admin';
import TenantSettingsLoadingState from '@/components/dashboard/tenant-settings/TenantSettingsLoadingState';
import TenantSettingsErrorState from '@/components/dashboard/tenant-settings/TenantSettingsErrorState';
import TenantSettingsOverviewCards from '@/components/dashboard/tenant-settings/TenantSettingsOverviewCards';
import TenantBrandingFormCard from '@/components/dashboard/tenant-settings/TenantBrandingFormCard';
import PortalSitesManager from '@/components/dashboard/PortalSitesManager';
import { triggerPublicRebuild } from '@/lib/publicRebuild';

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

      await triggerPublicRebuild({ tenantId: tenant.id, resource: 'tenant_branding', action: 'update' });

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

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-border/60 bg-card/70 p-4 shadow-sm backdrop-blur-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Tenant</p>
          <p className="mt-1 text-sm font-semibold text-foreground">{tenant.name}</p>
          <p className="text-xs text-muted-foreground">Current branding target</p>
        </div>
        <div className="rounded-2xl border border-border/60 bg-card/70 p-4 shadow-sm backdrop-blur-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Site Name</p>
          <p className="mt-1 text-sm font-semibold text-foreground">{watchedSiteName || tenant.name}</p>
          <p className="text-xs text-muted-foreground">Live label preview in this form state</p>
        </div>
        <div className="rounded-2xl border border-border/60 bg-card/70 p-4 shadow-sm backdrop-blur-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Brand Color</p>
          <div className="mt-2 flex items-center gap-3">
            <span className="h-8 w-8 rounded-xl border border-border/60" style={{ backgroundColor: watchedBrandColor }} />
            <span className="text-sm font-semibold text-foreground">{watchedBrandColor}</span>
          </div>
        </div>
        <div className="rounded-2xl border border-border/60 bg-card/70 p-4 shadow-sm backdrop-blur-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Font Family</p>
          <p className="mt-1 text-sm font-semibold text-foreground">{watchedFontFamily}</p>
          <p className="text-xs text-muted-foreground">Tenant theme typography baseline</p>
        </div>
      </div>

      <TenantSettingsOverviewCards
        tenant={tenant}
        watchedSiteName={watchedSiteName}
        watchedBrandColor={watchedBrandColor}
        watchedFontFamily={watchedFontFamily}
      />

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/70 shadow-sm backdrop-blur-sm">
            <div className="border-b border-border/70 bg-gradient-to-r from-primary/12 via-background/40 to-sky-500/12 p-4 sm:p-5">
              <h3 className="text-base font-semibold text-foreground">Branding workspace</h3>
              <p className="mt-1 text-sm text-muted-foreground">Update tenant-facing identity and keep portal branding aligned with the current tenant scope.</p>
            </div>
            <div className="p-4 sm:p-5">
              <TenantBrandingFormCard
                form={form}
                t={t}
                colorPickerId={colorPickerId}
              />
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/70 shadow-sm backdrop-blur-sm">
            <div className="border-b border-border/70 bg-gradient-to-r from-emerald-500/12 via-background/40 to-primary/12 p-4 sm:p-5">
              <h3 className="text-base font-semibold text-foreground">Portal site bindings</h3>
              <p className="mt-1 text-sm text-muted-foreground">Review tenant site mappings and public portal wiring without leaving the settings workflow.</p>
            </div>
            <div className="p-4 sm:p-5">
              <PortalSitesManager />
            </div>
          </div>

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
