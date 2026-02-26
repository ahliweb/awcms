import { format } from 'date-fns';
import { Activity, ChevronLeft, ChevronRight, Clock, RefreshCw, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TabsContent } from '@/components/ui/tabs';

function SSOActivityTab({
  loading,
  securityInfo,
  currentPage,
  totalCount,
  pageSize,
  onPrevious,
  onNext,
}) {
  const totalPages = Math.ceil(totalCount / pageSize) || 1;

  return (
    <TabsContent value="activity">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-muted-foreground" />
            <CardTitle>Recent Login Activity</CardTitle>
          </div>
          <CardDescription>
            Login events from audit logs (page {currentPage + 1} of {totalPages})
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : securityInfo.recentLogins.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <Users className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
              <p>No login activity recorded yet.</p>
              <p className="text-sm">Login events will appear here once users start signing in.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-md border">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/50">
                  <tr>
                    <th className="p-3 text-left font-medium text-muted-foreground">Time</th>
                    <th className="p-3 text-left font-medium text-muted-foreground">Email</th>
                    <th className="p-3 text-left font-medium text-muted-foreground">Status</th>
                    <th className="p-3 text-left font-medium text-muted-foreground">Channel</th>
                    <th className="p-3 text-left font-medium text-muted-foreground">IP Address</th>
                  </tr>
                </thead>

                <tbody className="divide-y">
                  {securityInfo.recentLogins.map((log, index) => {
                    const status = log.details?.status || 'success';
                    const errorMessage = log.details?.error;

                    return (
                      <tr key={log.id || index}>
                        <td className="p-3 text-muted-foreground">
                          <div className="flex items-center gap-2">
                            <Clock className="h-4 w-4 text-muted-foreground" />
                            {log.created_at ? format(new Date(log.created_at), 'dd MMM yyyy HH:mm:ss') : '-'}
                          </div>
                        </td>

                        <td className="p-3">{log.user?.email || log.details?.attempted_email || log.user_id || '-'}</td>

                        <td className="p-3">
                          <span
                            className={`rounded px-2 py-1 text-xs font-medium ${status === 'success' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}
                            title={errorMessage || ''}
                          >
                            {status === 'success' ? '✓ Success' : `✗ ${errorMessage || 'Failed'}`}
                          </span>
                        </td>

                        <td className="p-3">
                          <span className="rounded bg-secondary px-2 py-1 text-xs font-medium">
                            {log.channel || 'web'}
                          </span>
                        </td>

                        <td className="p-3 font-mono text-xs text-muted-foreground">
                          {log.ip_address || '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div className="flex items-center justify-between border-t bg-muted/20 p-3">
                <div className="text-sm text-muted-foreground">
                  Showing {currentPage * pageSize + 1} - {Math.min((currentPage + 1) * pageSize, totalCount)} of {totalCount}
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onPrevious}
                    disabled={currentPage === 0}
                  >
                    <ChevronLeft className="mr-1 h-4 w-4" /> Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onNext}
                    disabled={(currentPage + 1) * pageSize >= totalCount}
                  >
                    Next <ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </TabsContent>
  );
}

export default SSOActivityTab;
