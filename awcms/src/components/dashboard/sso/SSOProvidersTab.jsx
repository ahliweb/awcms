import { CheckCircle, XCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TabsContent } from '@/components/ui/tabs';

function SSOProvidersTab({ securityInfo }) {
  return (
    <TabsContent value="providers" className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Authentication Providers</CardTitle>
          <CardDescription>Identity providers configured for this platform</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="p-3 text-left font-medium text-muted-foreground">Provider</th>
                  <th className="p-3 text-left font-medium text-muted-foreground">Provider ID</th>
                  <th className="p-3 text-left font-medium text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {securityInfo.authProviders.map((provider) => (
                  <tr key={provider.provider_id}>
                    <td className="flex items-center gap-2 p-3">
                      <span className="text-lg">{provider.icon}</span>
                      <span className="font-medium">{provider.name}</span>
                    </td>
                    <td className="p-3 font-mono text-xs text-muted-foreground">{provider.provider_id}</td>
                    <td className="p-3">
                      {provider.enabled ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                          <CheckCircle className="h-3 w-3" /> Enabled
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-1 text-xs font-medium text-muted-foreground">
                          <XCircle className="h-3 w-3" /> Disabled
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/10 dark:text-amber-300">
            <strong>Note:</strong> To enable/disable OAuth providers, configure them in the{' '}
            <a href="https://supabase.com/dashboard" target="_blank" rel="noopener noreferrer" className="underline">
              Supabase Dashboard -&gt; Authentication -&gt; Providers
            </a>
          </div>
        </CardContent>
      </Card>
    </TabsContent>
  );
}

export default SSOProvidersTab;
