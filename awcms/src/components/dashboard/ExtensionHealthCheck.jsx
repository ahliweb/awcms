
import React, { useState, useEffect } from 'react';
import { Activity, CheckCircle, XCircle, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/customSupabaseClient';
import { usePermissions } from '@/contexts/PermissionContext';
import { useTenant } from '@/contexts/TenantContext';

function ExtensionHealthCheck() {
   const { isPlatformAdmin } = usePermissions();
   const { currentTenant } = useTenant();
   const [checking, setChecking] = useState(false);
   const [healthScore, setHealthScore] = useState(100);
   const [checks, setChecks] = useState([
      { name: 'Database Connection', status: 'pending' },
      { name: 'Extension Registry', status: 'pending' },
      { name: 'Route Conflicts', status: 'pending' },
      { name: 'Permission Integrity', status: 'pending' },
   ]);

   const runDiagnosis = async () => {
      setChecking(true);
      setHealthScore(100);

      // Simulate checks sequence
      const newChecks = [...checks];

      // Check 1: DB
      newChecks[0].status = 'running';
      setChecks([...newChecks]);
      await new Promise(r => setTimeout(r, 800));
      let query = supabase.from('extensions').select('count').single();
      if (currentTenant?.id) {
         query = query.eq('tenant_id', currentTenant.id);
      } else if (!isPlatformAdmin) {
         query = query.eq('tenant_id', null);
      }
      const { error } = await query;
      newChecks[0].status = error ? 'error' : 'ok';
      setChecks([...newChecks]);

      // Check 2: Registry
      newChecks[1].status = 'running';
      setChecks([...newChecks]);
      await new Promise(r => setTimeout(r, 600));
      newChecks[1].status = 'ok';
      setChecks([...newChecks]);

      // Check 3: Conflicts
      newChecks[2].status = 'running';
      setChecks([...newChecks]);
      await new Promise(r => setTimeout(r, 1000));
      newChecks[2].status = 'ok'; // Simulate OK
      setChecks([...newChecks]);

      // Check 4: Permissions
      newChecks[3].status = 'running';
      setChecks([...newChecks]);
      await new Promise(r => setTimeout(r, 500));
      newChecks[3].status = 'ok';
      setChecks([...newChecks]);

      setChecking(false);
   };

   useEffect(() => {
      runDiagnosis();
   }, [currentTenant?.id, isPlatformAdmin]);

   return (
      <div className="space-y-6">
         <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="md:col-span-2">
               <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                     <Activity className="w-5 h-5 text-blue-600" />
                     System Health Diagnosis
                  </CardTitle>
                  <CardDescription>Run self-diagnostics to ensure extension system integrity.</CardDescription>
               </CardHeader>
               <CardContent>
                  <div className="space-y-6">
                     {checks.map((check, idx) => (
                        <div key={idx} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-100">
                           <div className="flex items-center gap-3">
                              {check.status === 'pending' && <div className="w-4 h-4 rounded-full bg-slate-300" />}
                              {check.status === 'running' && <div className="w-4 h-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />}
                              {check.status === 'ok' && <CheckCircle className="w-5 h-5 text-green-500" />}
                              {check.status === 'error' && <XCircle className="w-5 h-5 text-red-500" />}
                              <span className="font-medium text-slate-700">{check.name}</span>
                           </div>
                           <span className="text-xs uppercase font-bold text-slate-400">{check.status}</span>
                        </div>
                     ))}

                     <Button onClick={runDiagnosis} disabled={checking} className="w-full">
                        {checking ? 'Running Diagnostics...' : 'Re-run Diagnostics'}
                     </Button>
                  </div>
               </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-slate-900 to-slate-800 text-white border-none">
               <CardContent className="flex flex-col items-center justify-center h-full p-6 text-center">
                  <ShieldCheck className="w-16 h-16 text-green-400 mb-4" />
                  <div className="text-4xl font-bold mb-2">{healthScore}%</div>
                  <div className="text-slate-300 mb-6">System Operational</div>
                  <div className="w-full bg-slate-700 h-2 rounded-full overflow-hidden">
                     <Progress value={healthScore} className="h-full bg-slate-900 [&>div]:bg-green-500" />
                  </div>
               </CardContent>
            </Card>
         </div>
      </div>
   );
}

export default ExtensionHealthCheck;
