import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

function DashboardModuleIntro({
  icon: Icon,
  eyebrow,
  title,
  description,
  actions = null,
  badges = [],
  summaryCards = [],
  className,
  valueClassName = 'text-4xl',
}) {
  return (
    <div className={cn('space-y-8', className)}>
      <div className="rounded-3xl border border-border/70 bg-gradient-to-br from-background via-background to-primary/5 p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1.5">
            <div className="flex items-center gap-3">
              {Icon ? (
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-sm">
                  <Icon className="h-5 w-5" />
                </span>
              ) : null}
              <div>
                {eyebrow ? <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">{eyebrow}</p> : null}
                <p className="text-lg font-semibold text-foreground">{title}</p>
              </div>
            </div>
            {description ? <p className="max-w-3xl text-sm text-muted-foreground">{description}</p> : null}
          </div>
          {actions}
        </div>

        {badges.length > 0 ? (
          <div className="mt-5 flex flex-wrap gap-3 text-sm text-muted-foreground">
            {badges.map((badge) => {
              const BadgeIcon = badge.icon;

              return (
                <span key={badge.label} className="inline-flex items-center gap-2 rounded-full bg-background/70 px-3 py-1.5 shadow-sm">
                  {BadgeIcon ? <BadgeIcon className={cn('h-4 w-4', badge.iconClassName)} /> : null}
                  {badge.label}
                </span>
              );
            })}
          </div>
        ) : null}
      </div>

      {summaryCards.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-3">
          {summaryCards.map((card) => (
            <Card key={card.title} className="overflow-hidden rounded-2xl border-border/70 shadow-sm">
              <CardContent className="relative p-5">
                <div className={cn('pointer-events-none absolute inset-0 bg-gradient-to-br', card.accent)} />
                <div className="relative">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{card.title}</p>
                  <p className={cn('mt-3 font-semibold leading-none text-foreground', valueClassName)}>{card.value}</p>
                  <p className="mt-3 max-w-xs text-sm leading-6 text-muted-foreground">{card.description}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default DashboardModuleIntro;
