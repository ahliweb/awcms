
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PieChart as RePieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { PieChart } from 'lucide-react';

export function ContentDistribution({ data }) {
  const chartData = [
    { name: 'Blogs', value: data?.blogs || 0, color: '#3b82f6' },
    { name: 'Pages', value: data?.pages || 0, color: '#a855f7' },
    { name: 'Products', value: data?.products || 0, color: '#f97316' },
    { name: 'Users', value: data?.users || 0, color: '#22c55e' },
  ].filter(item => item.value > 0);

  const totalItems = chartData.reduce((sum, item) => sum + item.value, 0);

  return (
    <Card className="dashboard-surface dashboard-surface-hover col-span-1 min-w-0">
      <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100/80 pb-3 dark:border-slate-700/60">
        <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-800 dark:text-slate-100">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-200">
            <PieChart className="h-4 w-4" />
          </span>
          Content Overview
        </CardTitle>
        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
          Total {totalItems}
        </span>
      </CardHeader>
      <CardContent className="p-6 pt-4">
        {chartData.length > 0 ? (
          <div className="w-full h-[300px] relative" style={{ minHeight: '300px' }}>
            {/* minWidth/minHeight added to suppress Recharts warning during initial render/animation */}
            <ResponsiveContainer width="100%" height="100%" minWidth={100} minHeight={100}>
              <RePieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} strokeWidth={0} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    borderRadius: '12px',
                    border: 'none',
                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
                    padding: '8px 12px'
                  }}
                  itemStyle={{ color: '#1e293b', fontWeight: 500, fontSize: '13px' }}
                  cursor={false}
                />
                <Legend
                  verticalAlign="bottom"
                  height={36}
                  iconType="circle"
                  formatter={(value) => <span className="text-sm font-medium text-slate-600 dark:text-slate-300 ml-1">{value}</span>}
                />
                </RePieChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200/70 bg-slate-50/60 px-6 py-10 text-slate-400 dark:border-slate-700/60 dark:bg-slate-800/40 dark:text-slate-500">
            <PieChart className="h-6 w-6" />
            <span className="text-sm font-medium">No data available</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
