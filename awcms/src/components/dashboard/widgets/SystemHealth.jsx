
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
    <div className="flex items-center justify-between rounded-xl border border-slate-200/70 bg-white/70 p-3.5 transition-colors hover:bg-white/90 dark:border-slate-700/60 dark:bg-slate-800/60 dark:hover:bg-slate-800/80">
      <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{label}</span>
      <div className="flex items-center gap-3">
        <span className={`text-[10px] uppercase tracking-[0.2em] font-bold ${color}`}>{status}</span>
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
    <Card className="dashboard-surface dashboard-surface-hover col-span-1 min-w-0">
      <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100/80 pb-3 dark:border-slate-700/60">
        <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-800 dark:text-slate-100">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-100/70 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-200">
            <Activity className="w-4 h-4" />
          </span>
          System Health
        </CardTitle>
        <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-300">Live</span>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        <StatusItem label="Database Connection" status={health?.database || 'unknown'} />
        <StatusItem label="Storage Service" status={health?.storage || 'unknown'} />
        <StatusItem label="API Status" status={health?.api || 'unknown'} />
      </CardContent>
    </Card>
  );
}
