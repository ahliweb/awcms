import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { ImageUpload } from '@/components/ui/ImageUpload';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TENANT_FONT_OPTIONS } from '@/components/dashboard/tenant-settings/fontOptions';

function TenantBrandingFormCard({
  form,
  t,
  colorPickerId,
}) {
  return (
    <Card className="overflow-hidden border-border/60 bg-card/70 shadow-sm">
      <CardHeader className="border-b border-border/60 bg-muted/30">
        <CardTitle className="text-lg text-foreground">{t('tenant_settings.branding.title')}</CardTitle>
        <CardDescription>{t('tenant_settings.branding.description')}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-6 pt-6">
        <FormField
          control={form.control}
          name="siteName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('tenant_settings.branding.site_name')}</FormLabel>
              <FormControl>
                <Input
                  placeholder={t('tenant_settings.branding.site_name_placeholder')}
                  className="h-11 rounded-xl border-border/70 bg-background"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <FormField
            control={form.control}
            name="brandColor"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('tenant_settings.branding.brand_color')}</FormLabel>
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <button
                      type="button"
                      className="h-12 w-12 rounded-xl border border-border/70 shadow-sm transition-transform hover:scale-105"
                      style={{ backgroundColor: field.value }}
                      onClick={() => document.getElementById(colorPickerId)?.click()}
                    />
                    <input
                      id={colorPickerId}
                      type="color"
                      className="invisible absolute left-0 top-0 h-full w-full"
                      value={field.value}
                      onChange={(event) => field.onChange(event.target.value)}
                    />
                  </div>

                  <div className="flex-1">
                    <FormControl>
                      <Input
                        placeholder={t('tenant_settings.branding.brand_color_desc')}
                        {...field}
                        className="h-11 rounded-xl border-border/70 bg-background font-mono uppercase"
                      />
                    </FormControl>
                    <FormDescription className="mt-1 text-xs">
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
                <FormLabel>{t('tenant_settings.branding.font_family')}</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger className="h-11 rounded-xl border-border/70 bg-background">
                      <SelectValue placeholder={t('tenant_settings.branding.font_select_placeholder')} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {TENANT_FONT_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value} style={{ fontFamily: option.style }}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription>
                  {t('tenant_settings.branding.font_family_desc')}
                  <span
                    className="mt-2 block rounded-xl border border-border/70 bg-muted/30 p-2 text-lg text-foreground"
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
              <FormLabel>{t('tenant_settings.branding.logo')}</FormLabel>
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
  );
}

export default TenantBrandingFormCard;
