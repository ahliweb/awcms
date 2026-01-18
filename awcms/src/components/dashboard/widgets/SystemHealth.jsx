
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2, AlertTriangle, XCircle, Activity } from 'lucide-react';

const StatusItem = ({ label, status }) => {
  let Icon = CheckCircle2;
  let color = "text-emerald-500";
  let bg = "bg-emerald-500/10";
  let pulse = true;

  if (status === 'warning') {
    Icon = AlertTriangle;
    color = "text-amber-500";
    bg = "bg-amber-500/10";
    pulse = false;
  } else if (status === 'error' || status === 'down') {
    Icon = XCircle;
    color = "text-red-500";
    bg = "bg-red-500/10";
    pulse = false;
  }

  return (
    <div className="flex items-center justify-between p-4 bg-white/50 dark:bg-slate-700/50 rounded-xl border border-slate-100 dark:border-slate-600 hover:bg-white/80 dark:hover:bg-slate-700/80 transition-colors group">
      <span className="text-sm font-semibold text-slate-700 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-white transition-colors">{label}</span>
      <div className="flex items-center gap-3">
        <span className={`text-[10px] uppercase tracking-wider font-bold ${color} opacity-80`}>{status}</span>
        <div className={`p-1.5 rounded-full ${bg} relative`}>
          {pulse && <div className={`absolute inset-0 rounded-full ${bg} animate-ping opacity-50`}></div>}
          <Icon className={`w-4 h-4 ${color} relative z-10`} />
        </div>
      </div>
    </div>
  );
};

export function SystemHealth({ health }) {
  return (
    <Card className="col-span-1 min-w-0 border-white/40 dark:border-slate-700/40 bg-white/60 dark:bg-slate-800/60 backdrop-blur-xl shadow-sm hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-slate-800 dark:text-white">
          <Activity className="w-5 h-5 text-indigo-500" />
          System Health
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <StatusItem label="Database Connection" status={health?.database || 'unknown'} />
        <StatusItem label="Storage Service" status={health?.storage || 'unknown'} />
        <StatusItem label="API Status" status={health?.api || 'unknown'} />
      </CardContent>
    </Card>
  );
}
