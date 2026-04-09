
import { useTranslation } from 'react-i18next';
import { FileText, Layers, ShoppingBag, Users, HardDrive } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export function StatCards({ data, loading, className = '' }) {
  const { t } = useTranslation();
  const stats = [
    {
      title: t('dashboard.total_blogs'),
      value: data?.blogs,
      icon: FileText,
      accent: "from-sky-400 via-blue-500 to-indigo-500",
      iconWrapper: "border-sky-200/70 bg-sky-50/90 text-sky-700 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-200",
    },
    {
      title: t('dashboard.total_pages'),
      value: data?.pages,
      icon: Layers,
      accent: "from-indigo-400 via-violet-500 to-fuchsia-500",
      iconWrapper: "border-indigo-200/70 bg-indigo-50/90 text-indigo-700 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-200",
    },
    {
      title: t('dashboard.products'),
      value: data?.products,
      icon: ShoppingBag,
      accent: "from-amber-300 via-orange-400 to-rose-500",
      iconWrapper: "border-orange-200/70 bg-orange-50/90 text-orange-700 dark:border-orange-500/20 dark:bg-orange-500/10 dark:text-orange-200",
    },
    {
      title: t('dashboard.active_users'),
      value: data?.users,
      icon: Users,
      accent: "from-emerald-300 via-emerald-400 to-teal-500",
      iconWrapper: "border-emerald-200/70 bg-emerald-50/90 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200",
    },
    {
      title: t('dashboard.total_orders'),
      value: data?.orders,
      icon: ShoppingBag,
      accent: "from-cyan-300 via-teal-400 to-emerald-500",
      iconWrapper: "border-teal-200/70 bg-teal-50/90 text-teal-700 dark:border-teal-500/20 dark:bg-teal-500/10 dark:text-teal-200",
    },
    {
      title: t('dashboard.storage_used'),
      value: data?.storage,
      icon: HardDrive,
      accent: "from-slate-400 via-slate-500 to-slate-700",
      iconWrapper: "border-slate-200/70 bg-slate-100/90 text-slate-700 dark:border-slate-500/20 dark:bg-slate-700/20 dark:text-slate-200",
    }
  ];

  if (loading) {
    return (
        <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-6 ${className}`}>
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Card key={i} className="dashboard-surface dashboard-surface-hover overflow-hidden">
            <div className="h-1 w-full bg-slate-200/60 dark:bg-slate-700/60" />
            <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100/80 px-6 pt-4 pb-3 dark:border-slate-700/60">
              <Skeleton className="h-3 w-24 bg-slate-200/60 dark:bg-slate-700/60" />
              <Skeleton className="h-9 w-9 rounded-xl bg-slate-200/60 dark:bg-slate-700/60" />
            </CardHeader>
            <CardContent className="px-6 pb-5 pt-4">
              <Skeleton className="h-7 w-16 bg-slate-200/60 dark:bg-slate-700/60" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
      <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-6 ${className}`}>
        {stats.map((stat, index) => {
          const Icon = stat.icon;
          const value = stat.value ?? 0;
          return (
            <Card
              key={index}
              className="dashboard-surface dashboard-surface-hover overflow-hidden"
            >
            <div className={`h-1 w-full bg-gradient-to-r ${stat.accent}`} />
            <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100/80 px-6 pt-4 pb-3 dark:border-slate-700/60">
              <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                {stat.title}
              </span>
              <span className={`flex h-10 w-10 items-center justify-center rounded-2xl border ${stat.iconWrapper}`}>
                <Icon className="h-4 w-4" />
              </span>
            </CardHeader>

            <CardContent className="px-6 pb-5 pt-4">
              <div className="text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                {value}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
