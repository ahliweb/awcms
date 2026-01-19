
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FileEdit } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

export function ActivityFeed({ activities }) {
  const { t } = useTranslation();
  return (
    <Card className="bg-white/60 dark:bg-slate-800/60 backdrop-blur-xl border-white/40 dark:border-slate-700/40 shadow-sm hover:shadow-md transition-shadow">
      <CardHeader>
        <CardTitle>{t('dashboard.recent_activity')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {activities && activities.length > 0 ? (
            activities.map((activity, index) => (
              <div key={index} className="flex items-start gap-4 pb-4 border-b border-slate-100/50 dark:border-slate-700/50 last:border-0 last:pb-0 hover:bg-white/40 dark:hover:bg-slate-700/40 p-2 -mx-2 rounded-lg transition-colors">
                <div className="bg-blue-100 dark:bg-blue-900/30 p-2 rounded-full shrink-0">
                  <FileEdit className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                </div>
                <div className="space-y-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                    <span className="font-bold">{activity.user}</span> {activity.action} a {activity.type}
                  </p>
                  <p className="text-sm text-slate-600 dark:text-slate-300 truncate">
                    "{activity.title}"
                  </p>
                  <p className="text-xs text-slate-400 font-medium">
                    {formatDistanceToNow(new Date(activity.time), { addSuffix: true })}
                  </p>
                </div>
              </div>
            ))
          ) : (
            <div className="text-center text-slate-500 dark:text-slate-400 py-8">
              {t('dashboard.no_activity')}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
