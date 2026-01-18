
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FileEdit } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

export function ActivityFeed({ activities }) {
  return (
    <Card className="bg-white/60 dark:bg-slate-800/60 backdrop-blur-xl border-white/40 dark:border-slate-700/40 shadow-sm hover:shadow-md transition-shadow">
      <CardHeader>
        <CardTitle>Recent Activity</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {activities && activities.length > 0 ? (
            activities.map((activity, index) => (
              <div key={index} className="flex items-start gap-4 pb-4 border-b border-slate-100 dark:border-slate-700 last:border-0 last:pb-0">
                <div className="bg-blue-100 dark:bg-blue-900/30 p-2 rounded-full">
                  <FileEdit className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-slate-900 dark:text-white">
                    <span className="font-bold">{activity.user}</span> {activity.action} a {activity.type}
                  </p>
                  <p className="text-sm text-slate-600 dark:text-slate-300">
                    "{activity.title}"
                  </p>
                  <p className="text-xs text-slate-400">
                    {formatDistanceToNow(new Date(activity.time), { addSuffix: true })}
                  </p>
                </div>
              </div>
            ))
          ) : (
            <div className="text-center text-slate-500 dark:text-slate-400 py-8">
              No recent activity found.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
