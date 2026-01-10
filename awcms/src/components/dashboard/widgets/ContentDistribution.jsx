
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';

export function ContentDistribution({ data }) {
  const chartData = [
    { name: 'Articles', value: data?.articles || 0, color: '#3b82f6' },
    { name: 'Pages', value: data?.pages || 0, color: '#a855f7' },
    { name: 'Products', value: data?.products || 0, color: '#f97316' },
    { name: 'Users', value: data?.users || 0, color: '#22c55e' },
  ].filter(item => item.value > 0);

  return (
    <Card className="col-span-1 border-slate-200 shadow-sm h-full">
      <CardHeader>
        <CardTitle>Content Overview</CardTitle>
      </CardHeader>
      <CardContent className="h-[300px] min-h-[300px] p-6">
        {chartData.length > 0 ? (
          <div className="w-full h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
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
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  itemStyle={{ color: '#1e293b' }}
                />
                <Legend verticalAlign="bottom" height={36} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-slate-400">
            No data available
          </div>
        )}
      </CardContent>
    </Card>
  );
}
