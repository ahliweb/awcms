import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { supabase } from '@/lib/customSupabaseClient';
import { useTenant } from '@/contexts/TenantContext';
import { usePermissions } from '@/contexts/PermissionContext';
import { useToast } from '@/components/ui/use-toast';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ImageUpload } from '@/components/ui/ImageUpload';
import { Loader2, Save } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function TenantSettings() {
    const { t } = useTranslation();
    const { currentTenant: tenant, loading: tenantLoading } = useTenant();
    const { checkAccess } = usePermissions();
    const { toast } = useToast();
    const [saving, setSaving] = useState(false);

    // Permission Check
    const canManageSettings = checkAccess('update', 'setting');
    // Ideally we'd have a specific permission 'manage_tenant_settings', but 'update_settings' is a fair proxy for now.

    const form = useForm({
        defaultValues: {
            brandColor: '#000000',
            fontFamily: 'Inter',
            logoUrl: '',
            siteName: ''
        }
    });

    useEffect(() => {
        if (tenant) {
            form.reset({
                brandColor: tenant.config?.theme?.brandColor || '#000000',
                fontFamily: tenant.config?.theme?.fontFamily || 'Inter',
                logoUrl: tenant.config?.theme?.logoUrl || '',
                siteName: tenant.config?.settings?.siteName || tenant.name || ''
            });
        }
    }, [tenant, form]);

    const onSubmit = async (values) => {
        setSaving(true);
        try {
            const newConfig = {
                ...tenant.config,
                theme: {
                    brandColor: values.brandColor,
                    fontFamily: values.fontFamily,
                    logoUrl: values.logoUrl
                },
                settings: {
                    ...tenant.config?.settings,
                    siteName: values.siteName
                }
            };

            const { error } = await supabase
                .from('tenants')
                .update({
                    config: newConfig,
                    updated_at: new Date().toISOString()
                })
                .eq('id', tenant.id);

            if (error) throw error;

            toast({ title: t('tenant_settings.toasts.saved_title'), description: t('tenant_settings.toasts.saved_desc') });

            // Note: refreshTenant not available in current TenantContext
            // Full refresh would require page reload or context enhancement

        } catch (err) {
            console.error('Error saving settings:', err);
            toast({ variant: 'destructive', title: t('tenant_settings.toasts.error_title'), description: err.message });
        } finally {
            setSaving(false);
        }
    };

    if (tenantLoading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin text-slate-400" /></div>;
    if (!tenant) return <div className="p-8 text-center"><h2 className="text-xl font-bold text-slate-800">{t('tenant_settings.errors.tenant_not_found')}</h2><p className="text-slate-500">{t('tenant_settings.errors.tenant_load_error')}</p></div>;

    if (!canManageSettings) {
        return (
            <div className="p-8 text-center">
                <h2 className="text-xl font-bold text-slate-800">{t('tenant_settings.errors.access_denied')}</h2>
                <p className="text-slate-500">{t('tenant_settings.errors.access_denied_desc')}</p>
            </div>
        );
    }

    return (
        <div className="max-w-5xl mx-auto space-y-8 pb-12">
            <div className="space-y-1">
                <h1 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">{t('tenant_settings.title')}</h1>
                <p className="text-slate-500 dark:text-slate-400">{t('tenant_settings.description')}</p>
            </div>

            <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

                    {/* Branding Section */}
                    <Card className="dashboard-surface dashboard-surface-hover overflow-hidden">
                        <CardHeader className="border-b border-slate-200/60 bg-slate-50/70 dark:border-slate-800/70 dark:bg-slate-900/60">
                            <CardTitle className="text-lg text-slate-900 dark:text-white">{t('tenant_settings.branding.title')}</CardTitle>
                            <CardDescription>{t('tenant_settings.branding.description')}</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6 pt-6">

                            <FormField
                                control={form.control}
                                name="siteName"
                                render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-sm font-medium text-slate-600 dark:text-slate-300">{t('tenant_settings.branding.site_name')}</FormLabel>
                                            <FormControl>
                                                <Input
                                                    placeholder={t('tenant_settings.branding.site_name_placeholder')}
                                                    className="h-11 rounded-xl border-slate-200/70 bg-white/90 shadow-sm focus:border-indigo-500/60 focus:ring-indigo-500/30 dark:border-slate-700/70 dark:bg-slate-950/60"
                                                    {...field}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                )}
                            />

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <FormField
                                    control={form.control}
                                    name="brandColor"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-sm font-medium text-slate-600 dark:text-slate-300">{t('tenant_settings.branding.brand_color')}</FormLabel>
                                            <div className="flex gap-3 items-center">
                                                <div className="relative">
                                                    <div
                                                        className="w-12 h-12 rounded-xl border border-slate-200/70 shadow-sm cursor-pointer transition-transform hover:scale-105"
                                                        style={{ backgroundColor: field.value }}
                                                        onClick={() => document.getElementById('color-picker').click()}
                                                    />
                                                    <input
                                                        id="color-picker"
                                                        type="color"
                                                        className="invisible absolute top-0 left-0 w-full h-full"
                                                        value={field.value}
                                                        onChange={(e) => field.onChange(e.target.value)}
                                                    />
                                                </div>
                                                <div className="flex-1">
                                                    <FormControl>
                                                        <Input
                                                            placeholder={t('tenant_settings.branding.brand_color_desc')}
                                                            {...field}
                                                            className="h-11 rounded-xl border-slate-200/70 bg-white/90 font-mono uppercase shadow-sm focus:border-indigo-500/60 focus:ring-indigo-500/30 dark:border-slate-700/70 dark:bg-slate-950/60"
                                                            onChange={(e) => {
                                                                const val = e.target.value;
                                                                field.onChange(val);
                                                            }}
                                                        />
                                                    </FormControl>
                                                    <FormDescription className="text-xs mt-1">
                                                        {t('tenant_settings.branding.brand_color_desc')}
                                                    </FormDescription>
                                                </div>
                                            </div>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="fontFamily"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-sm font-medium text-slate-600 dark:text-slate-300">{t('tenant_settings.branding.font_family')}</FormLabel>
                                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                <FormControl>
                                                    <SelectTrigger className="h-11 rounded-xl border-slate-200/70 bg-white/90 shadow-sm focus:border-indigo-500/60 focus:ring-indigo-500/30 dark:border-slate-700/70 dark:bg-slate-950/60">
                                                        <SelectValue placeholder={t('tenant_settings.branding.font_select_placeholder')} />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    <SelectItem value="Inter" style={{ fontFamily: 'Inter, sans-serif' }}>Inter (Default)</SelectItem>
                                                    <SelectItem value="Roboto" style={{ fontFamily: 'Roboto, sans-serif' }}>Roboto</SelectItem>
                                                    <SelectItem value="Open Sans" style={{ fontFamily: '"Open Sans", sans-serif' }}>Open Sans</SelectItem>
                                                    <SelectItem value="Lato" style={{ fontFamily: 'Lato, sans-serif' }}>Lato</SelectItem>
                                                    <SelectItem value="Montserrat" style={{ fontFamily: 'Montserrat, sans-serif' }}>Montserrat</SelectItem>
                                                    <SelectItem value="Poppins" style={{ fontFamily: 'Poppins, sans-serif' }}>Poppins</SelectItem>
                                                    <SelectItem value="Playfair Display" style={{ fontFamily: '"Playfair Display", serif' }}>Playfair Display</SelectItem>
                                                    <SelectItem value="Merriweather" style={{ fontFamily: 'Merriweather, serif' }}>Merriweather</SelectItem>
                                                    <SelectItem value="system-ui" style={{ fontFamily: 'system-ui, sans-serif' }}>System Default</SelectItem>
                                                </SelectContent>
                                            </Select>
                                            <FormDescription>
                                                {t('tenant_settings.branding.font_family_desc')}
                                                <span
                                                    className="block mt-2 text-lg text-slate-800 border border-slate-200/70 p-2 rounded-xl bg-slate-50/70"
                                                    style={{ fontFamily: field.value === 'system-ui' ? 'system-ui' : `${field.value}, sans-serif` }}
                                                >
                                                    {t('tenant_settings.branding.font_preview')}
                                                </span>
                                            </FormDescription>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>

                            <FormField
                                control={form.control}
                                name="logoUrl"
                                render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-sm font-medium text-slate-600 dark:text-slate-300">{t('tenant_settings.branding.logo')}</FormLabel>
                                            <FormControl>
                                                <ImageUpload
                                                    value={field.value}
                                                    onChange={field.onChange}
                                                    className="w-full"
                                                />
                                            </FormControl>
                                            <FormDescription>{t('tenant_settings.branding.logo_desc')}</FormDescription>
                                            <FormMessage />
                                        </FormItem>
                                )}
                            />

                        </CardContent>
                    </Card>

                    <div className="flex justify-end">
                        <Button type="submit" disabled={saving} className="bg-indigo-600 hover:bg-indigo-700">
                            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                            <Save className="w-4 h-4 mr-2" />
                            {saving ? t('tenant_settings.buttons.saving') : t('tenant_settings.buttons.save_changes')}
                        </Button>
                    </div>

                </form>
            </Form>
        </div>
    );
}
