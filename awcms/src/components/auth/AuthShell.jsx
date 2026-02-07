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
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-slate-50 via-white to-indigo-50 px-6 py-12 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-44 right-0 h-96 w-96 rounded-full bg-indigo-500/15 blur-3xl dark:bg-indigo-500/10" />
        <div className="absolute -bottom-36 left-0 h-80 w-80 rounded-full bg-sky-400/15 blur-3xl dark:bg-sky-400/10" />
      </div>

      <div className={cn('relative z-10 mx-auto flex w-full max-w-5xl flex-col gap-10 lg:flex-row lg:items-center lg:gap-16', className)}>
        <aside className="hidden w-full flex-1 flex-col gap-6 lg:flex">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-blue-600 text-white shadow-lg shadow-indigo-500/25">
              <LayoutGrid className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">AWCMS</p>
              <h2 className="text-2xl font-semibold text-slate-900 dark:text-white">{sideTitle}</h2>
            </div>
          </div>

          <p className="max-w-md text-base text-slate-600 dark:text-slate-300">{sideSubtitle}</p>

          <div className="grid gap-4">
            {sideItems.map((item, index) => {
              const Icon = item.icon;
              return (
                <div
                  key={`${item.title}-${index}`}
                  className="flex items-start gap-3 rounded-2xl border border-white/60 bg-white/70 p-4 text-slate-700 shadow-sm backdrop-blur-sm dark:border-slate-800/70 dark:bg-slate-900/60 dark:text-slate-200"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300">
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
          <div className="w-full max-w-md rounded-3xl border border-slate-200/70 bg-white/85 p-8 shadow-2xl backdrop-blur-xl dark:border-slate-800/70 dark:bg-slate-950/70 md:p-10">
            <div className="space-y-4 text-center">
              <span className="inline-flex items-center justify-center gap-2 rounded-full bg-indigo-50 px-4 py-1 text-xs font-semibold text-indigo-700 shadow-sm shadow-indigo-500/10 dark:bg-indigo-500/10 dark:text-indigo-200">
                <ShieldCheck className="h-4 w-4" />
                {badge}
              </span>
              <div className="space-y-1">
                <h1 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">{title}</h1>
                {subtitle && <p className="text-sm text-slate-500 dark:text-slate-300">{subtitle}</p>}
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
