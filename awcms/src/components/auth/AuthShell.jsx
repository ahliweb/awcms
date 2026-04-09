import { LayoutGrid, ShieldCheck, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

const defaultItems = [
  {
    icon: ShieldCheck,
    title: 'Secure access',
    description: 'Turnstile protection, 2FA, and audit trails built in.',
  },
  {
    icon: LayoutGrid,
    title: 'Unified control',
    description: 'Manage content, tenants, and users from one workspace.',
  },
  {
    icon: Sparkles,
    title: 'Actionable insights',
    description: 'Track performance, approvals, and activity in real time.',
  },
];

const AuthShell = ({
  title,
  subtitle,
  children,
  footer,
  sideTitle = 'AWCMS Admin',
  sideSubtitle = 'Operate your content, tenants, and analytics from one secure console.',
  sideItems = defaultItems,
  badge = 'Secure Access',
  className = '',
}) => {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[linear-gradient(180deg,rgba(246,248,251,0.98),rgba(236,241,247,0.98))] px-6 py-12 dark:bg-[linear-gradient(180deg,rgba(7,11,21,0.99),rgba(15,23,42,0.99))]">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(720px_420px_at_10%_10%,rgba(56,189,248,0.18),transparent_55%),radial-gradient(620px_360px_at_90%_0%,rgba(129,140,248,0.16),transparent_48%)]" />
        <div className="absolute inset-0 opacity-[0.05] [background-image:linear-gradient(to_right,rgba(15,23,42,0.12)_1px,transparent_1px),linear-gradient(to_bottom,rgba(15,23,42,0.1)_1px,transparent_1px)] [background-size:32px_32px] dark:opacity-[0.08]" />
      </div>

      <div className={cn('relative z-10 mx-auto flex w-full max-w-5xl flex-col gap-10 lg:flex-row lg:items-center lg:gap-16', className)}>
        <aside className="hidden w-full flex-1 flex-col gap-6 lg:flex">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-[1.4rem] border border-white/70 bg-slate-950 text-white shadow-[0_24px_45px_-28px_rgba(15,23,42,0.8)] dark:border-white/10">
              <LayoutGrid className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">EmDash</p>
              <h2 className="text-2xl font-semibold tracking-[-0.03em] text-slate-900 dark:text-white">{sideTitle}</h2>
            </div>
          </div>

          <p className="max-w-md text-base leading-7 text-slate-600 dark:text-slate-300">{sideSubtitle}</p>

          <div className="grid gap-4">
            {sideItems.map((item, index) => {
              const Icon = item.icon;
              return (
                <div
                  key={`${item.title}-${index}`}
                  className="emdash-panel flex items-start gap-3 p-4 text-slate-700 dark:text-slate-200"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-900/10 bg-slate-950 text-white dark:border-white/10 dark:bg-white/10 dark:text-sky-200">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{item.title}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{item.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        <section className="flex w-full flex-1 justify-center">
          <div className="emdash-panel relative w-full max-w-md overflow-hidden p-8 md:p-10">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[radial-gradient(360px_110px_at_0%_0%,rgba(56,189,248,0.18),transparent_60%),radial-gradient(320px_110px_at_100%_0%,rgba(129,140,248,0.16),transparent_58%)]" />
            <div className="space-y-4 text-center">
              <span className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-900/10 bg-white/80 px-4 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-700 shadow-sm dark:border-white/10 dark:bg-slate-900/70 dark:text-slate-200">
                <ShieldCheck className="h-4 w-4" />
                {badge}
              </span>
              <div className="space-y-1">
                <h1 className="text-3xl font-semibold tracking-[-0.04em] text-slate-900 dark:text-white">{title}</h1>
                {subtitle && <p className="text-sm leading-6 text-slate-500 dark:text-slate-300">{subtitle}</p>}
              </div>
            </div>

            <div className="mt-8 space-y-6">
              {children}
            </div>

            {footer && <div className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">{footer}</div>}
          </div>
        </section>
      </div>
    </div>
  );
};

export default AuthShell;
