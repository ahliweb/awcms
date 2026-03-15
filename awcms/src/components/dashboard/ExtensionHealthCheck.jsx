
import { useState, useEffect } from 'react';
import { Activity, CheckCircle, XCircle, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { usePermissions } from '@/contexts/PermissionContext';
import { useTenant } from '@/contexts/TenantContext';
import { runExtensionHealthCheck } from '@/lib/extensionLifecycleApi';

const initialChecks = [
   { name: 'Database Connection', status: 'pending' },
   { name: 'Extension Registry', status: 'pending' },
   { name: 'Route Conflicts', status: 'pending' },
   { name: 'Permission Integrity', status: 'pending' },
];

function ExtensionHealthCheck() {
   usePermissions();
   const { currentTenant } = useTenant();
   const [checking, setChecking] = useState(false);
   const [healthScore, setHealthScore] = useState(100);
   const [checks, setChecks] = useState(() => initialChecks.map(check => ({ ...check })));

   const runDiagnosis = async () => {
      setChecking(true);
      setHealthScore(100);

      // Simulate checks sequence
      const newChecks = initialChecks.map(check => ({ ...check }));

      // Check 1: DB
      newChecks[0].status = 'running';
      setChecks([...newChecks]);
      await new Promise(r => setTimeout(r, 800));
      const result = await runExtensionHealthCheck({ tenantId: currentTenant?.id || null });
      newChecks[0].status = result?.checks?.database === 'ok' ? 'ok' : 'error';
      setChecks([...newChecks]);

      // Check 2: Registry
      newChecks[1].status = 'running';
      setChecks([...newChecks]);
      await new Promise(r => setTimeout(r, 600));
      newChecks[1].status = result?.checks?.registry === 'ok' ? 'ok' : 'error';
      setChecks([...newChecks]);

      // Check 3: Conflicts
      newChecks[2].status = 'running';
      setChecks([...newChecks]);
      await new Promise(r => setTimeout(r, 1000));
      newChecks[2].status = result?.checks?.collisions === 'ok' ? 'ok' : 'error';
      setChecks([...newChecks]);

      // Check 4: Permissions
      newChecks[3].status = 'running';
      setChecks([...newChecks]);
      await new Promise(r => setTimeout(r, 500));
      newChecks[3].status = result?.checks?.permissions === 'ok' ? 'ok' : 'error';
      setChecks([...newChecks]);

      setHealthScore(result?.score || 0);
      setChecking(false);
   };

   useEffect(() => {
      // Run once on mount
      runDiagnosis();
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, []);

   return (
      <div className="space-y-6">
         <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="md:col-span-2 border-border/60 bg-card/75">
               <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                     <Activity className="h-5 w-5 text-primary" />
                     System Health Diagnosis
                  </CardTitle>
                  <CardDescription>Run self-diagnostics to ensure extension system integrity.</CardDescription>
               </CardHeader>
               <CardContent>
                  <div className="space-y-6">
                     {checks.map((check, idx) => (
                        <div key={idx} className="flex items-center justify-between rounded-xl border border-border/60 bg-card/65 p-3">
                           <div className="flex items-center gap-3">
                              {check.status === 'pending' && <div className="h-4 w-4 rounded-full bg-muted" />}
                              {check.status === 'running' && <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />}
                              {check.status === 'ok' && <CheckCircle className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />}
                              {check.status === 'error' && <XCircle className="h-5 w-5 text-destructive" />}
                              <span className="font-medium text-foreground">{check.name}</span>
                           </div>
                           <span className="text-xs font-bold uppercase text-muted-foreground">{check.status}</span>
                        </div>
                     ))}

                     <Button onClick={runDiagnosis} disabled={checking} className="w-full rounded-xl bg-primary text-primary-foreground hover:opacity-95">
                        {checking ? 'Running Diagnostics...' : 'Re-run Diagnostics'}
                     </Button>
                  </div>
               </CardContent>
            </Card>

            <Card className="border-border/60 bg-gradient-to-br from-foreground to-foreground/90 text-primary-foreground">
               <CardContent className="flex flex-col items-center justify-center h-full p-6 text-center">
                  <ShieldCheck className="mb-4 h-16 w-16 text-emerald-400" />
                  <div className="text-4xl font-bold mb-2">{healthScore}%</div>
                  <div className="mb-6 text-primary-foreground/80">System Operational</div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-primary-foreground/20">
                     <Progress value={healthScore} className="h-full bg-transparent [&>div]:bg-emerald-400" />
                  </div>
               </CardContent>
            </Card>
         </div>
      </div>
   );
}

export default ExtensionHealthCheck;
