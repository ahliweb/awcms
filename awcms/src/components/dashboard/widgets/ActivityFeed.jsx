
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FileEdit, Activity } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

export function ActivityFeed({ activities }) {
  const { t } = useTranslation();
  return (
    <Card className="dashboard-surface dashboard-surface-hover">
      <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100/80 pb-3 dark:border-slate-700/60">
        <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-800 dark:text-slate-100">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-200">
            <Activity className="h-4 w-4" />
          </span>
          {t('dashboard.recent_activity')}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        <div className="space-y-4">
          {activities && activities.length > 0 ? (
            activities.map((activity, index) => (
              <div key={index} className="flex items-start gap-4 rounded-xl border border-slate-200/70 bg-white/70 p-3.5 shadow-sm transition-colors hover:border-slate-300/70 hover:bg-white dark:border-slate-700/60 dark:bg-slate-800/40 dark:hover:border-slate-600/80">
                <div className="bg-blue-100/80 dark:bg-blue-900/30 p-2 rounded-full shrink-0">
                  <FileEdit className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                </div>
                <div className="space-y-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                    <span className="font-bold">{activity.user}</span> {activity.action} a {activity.type}
                  </p>
                  <p className="text-sm text-slate-600 dark:text-slate-300 truncate">
                    &quot;{activity.title}&quot;
                  </p>
                  <p className="text-xs text-slate-400 font-medium">
                    {formatDistanceToNow(new Date(activity.time), { addSuffix: true })}
                  </p>
                </div>
              </div>
            ))
          ) : (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200/70 bg-slate-50/60 px-6 py-10 text-slate-400 dark:border-slate-700/60 dark:bg-slate-800/40 dark:text-slate-500">
              <Activity className="h-6 w-6" />
              <span className="mt-2 text-sm font-medium">{t('dashboard.no_activity')}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
