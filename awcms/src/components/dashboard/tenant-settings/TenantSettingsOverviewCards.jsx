import { Building2, Palette, Type } from 'lucide-react';

function TenantSettingsOverviewCards({
  tenant,
  watchedSiteName,
  watchedBrandColor,
  watchedFontFamily,
}) {
  return (
    <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className="rounded-2xl border border-border/60 bg-card/65 p-4 shadow-sm backdrop-blur-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Tenant</p>
            <p className="mt-1 text-sm font-semibold text-foreground">{tenant.name}</p>
            <p className="text-xs text-muted-foreground">Slug: {tenant.slug}</p>
          </div>
          <span className="rounded-xl border border-border/70 bg-background/70 p-2 text-primary">
            <Building2 className="h-4 w-4" />
          </span>
        </div>
      </div>

      <div className="rounded-2xl border border-border/60 bg-card/65 p-4 shadow-sm backdrop-blur-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Site Name</p>
            <p className="mt-1 truncate text-sm font-semibold text-foreground">{watchedSiteName || '-'}</p>
            <p className="text-xs text-muted-foreground">Public branding label</p>
          </div>
          <span className="rounded-xl border border-primary/25 bg-primary/10 p-2 text-primary">
            <Palette className="h-4 w-4" />
          </span>
        </div>
      </div>

      <div className="rounded-2xl border border-border/60 bg-card/65 p-4 shadow-sm backdrop-blur-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Brand Color</p>
            <p className="mt-1 text-sm font-semibold text-foreground">{watchedBrandColor || '#000000'}</p>
            <p className="text-xs text-muted-foreground">Theme accent value</p>
          </div>
          <span
            className="h-8 w-8 rounded-xl border border-border/70"
            style={{ backgroundColor: watchedBrandColor || '#000000' }}
          />
        </div>
      </div>

      <div className="rounded-2xl border border-border/60 bg-card/65 p-4 shadow-sm backdrop-blur-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Font Family</p>
            <p className="mt-1 text-sm font-semibold text-foreground">{watchedFontFamily || 'Inter'}</p>
            <p className="text-xs text-muted-foreground">Applied typography base</p>
          </div>
          <span className="rounded-xl border border-border/70 bg-background/70 p-2 text-primary">
            <Type className="h-4 w-4" />
          </span>
        </div>
      </div>
    </div>
  );
}

export default TenantSettingsOverviewCards;
