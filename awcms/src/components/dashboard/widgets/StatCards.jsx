
import { useTranslation } from 'react-i18next';
import { FileText, Layers, ShoppingBag, Users, HardDrive } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export function StatCards({ data, loading, className = '' }) {
  const { t } = useTranslation();
  const stats = [
    {
      title: t('dashboard.total_blogs'),
      value: data?.blogs,
      icon: FileText,
      gradient: "from-blue-500 to-blue-600",
      shadow: "shadow-blue-500/20",
    },
    {
      title: t('dashboard.total_pages'),
      value: data?.pages,
      icon: Layers,
      gradient: "from-purple-500 to-purple-600",
      shadow: "shadow-purple-500/20",
    },
    {
      title: t('dashboard.products'),
      value: data?.products,
      icon: ShoppingBag,
      gradient: "from-orange-500 to-orange-600",
      shadow: "shadow-orange-500/20",
    },
    {
      title: t('dashboard.active_users'),
      value: data?.users,
      icon: Users,
      gradient: "from-emerald-500 to-emerald-600",
      shadow: "shadow-emerald-500/20",
    },
    {
      title: t('dashboard.total_orders'),
      value: data?.orders,
      icon: ShoppingBag,
      gradient: "from-teal-500 to-teal-600",
      shadow: "shadow-teal-500/20",
    },
    {
      title: t('dashboard.storage_used'),
      value: data?.storage,
      icon: HardDrive,
      gradient: "from-slate-600 to-slate-700",
      shadow: "shadow-slate-500/20",
    }
  ];

  if (loading) {
    return (
      <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-6 ${className}`}>
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Card key={i} className="dashboard-surface dashboard-surface-hover overflow-hidden h-32">
            <CardContent className="p-6 flex flex-col justify-between h-full">
              <Skeleton className="h-4 w-24 bg-slate-200/60 dark:bg-slate-700/60" />
              <div className="flex justify-between items-end">
                <Skeleton className="h-8 w-16 bg-slate-200/60 dark:bg-slate-700/60" />
                <Skeleton className="h-10 w-10 rounded-xl bg-slate-200/60 dark:bg-slate-700/60" />
              </div>
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
          return (
            <Card
              key={index}
              className="dashboard-surface dashboard-surface-hover group relative overflow-hidden hover:shadow-lg transition-all duration-300 hover:-translate-y-1"
            >
            {/* Subtle Gradient Glow Background */}
            <div className={`absolute -right-6 -top-6 w-24 h-24 rounded-full bg-gradient-to-br ${stat.gradient} opacity-10 blur-2xl group-hover:opacity-20 transition-opacity`}></div>

            <CardContent className="p-5 flex flex-col justify-between h-full relative z-10">
              <span className="text-sm font-medium text-slate-500 dark:text-slate-400 group-hover:text-slate-700 dark:group-hover:text-slate-300 transition-colors">
                {stat.title}
              </span>

              <div className="flex items-end justify-between mt-4">
                <div className="text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                  {stat.value}
                </div>

                <div className={`p-2.5 rounded-xl bg-gradient-to-br ${stat.gradient} text-white shadow-lg ${stat.shadow} transform group-hover:scale-110 transition-transform duration-300`}>
                  <Icon className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
