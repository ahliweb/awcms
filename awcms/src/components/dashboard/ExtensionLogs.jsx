
import { useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Terminal } from 'lucide-react';

// Mock logs for demonstration as we don't have a real log stream
const MOCK_LOGS = [
  { id: 1, timestamp: new Date(Date.now() - 1000 * 60 * 5).toISOString(), level: 'info', message: 'System initialized' },
  { id: 2, timestamp: new Date(Date.now() - 1000 * 60 * 2).toISOString(), level: 'success', message: 'Extension "SEO Pro" loaded successfully' },
  { id: 3, timestamp: new Date(Date.now() - 1000 * 30).toISOString(), level: 'warning', message: 'High memory usage detected in background job' },
  { id: 4, timestamp: new Date().toISOString(), level: 'info', message: 'Checking for extension updates...' },
];

function ExtensionLogs() {
  const [logs] = useState(MOCK_LOGS);

  return (
    <Card className="h-full">
      <CardHeader className="pb-3 border-b">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Terminal className="w-5 h-5" />
          System Logs
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[400px] p-4">
          <div className="space-y-2 font-mono text-sm">
            {logs.map(log => (
              <div key={log.id} className="flex gap-3 items-start">
                <span className="text-slate-400 whitespace-nowrap text-xs mt-0.5">
                  {new Date(log.timestamp).toLocaleTimeString()}
                </span>
                <div className="flex-1 break-all">
                  <span className={`
                        mr-2 uppercase text-[10px] font-bold px-1.5 py-0.5 rounded
                        ${log.level === 'info' ? 'bg-blue-100 text-blue-700' : ''}
                        ${log.level === 'success' ? 'bg-green-100 text-green-700' : ''}
                        ${log.level === 'warning' ? 'bg-yellow-100 text-yellow-700' : ''}
                        ${log.level === 'error' ? 'bg-red-100 text-red-700' : ''}
                     `}>
                    {log.level}
                  </span>
                  <span className="text-slate-700">{log.message}</span>
                </div>
              </div>
            ))}
            <div className="text-xs text-slate-400 pt-2 border-t border-dashed border-slate-200 mt-4">
              End of recent logs
            </div>
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

export default ExtensionLogs;
