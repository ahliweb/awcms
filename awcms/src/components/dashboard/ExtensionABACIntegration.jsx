
import { useState, useEffect, useCallback } from 'react';
import { Shield, Check, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useTranslation } from 'react-i18next';

function ExtensionABACIntegration({ extensionId }) {
   const { toast } = useToast();
   const { t } = useTranslation();
   const [roles, setRoles] = useState([]);
   const [extensionPermissions, setExtensionPermissions] = useState([]);
   const [activeMatrix, setActiveMatrix] = useState({}); // { roleId: Set(permNames) }
   const [loading, setLoading] = useState(true);

   const fetchData = useCallback(async () => {
      setLoading(true);
      try {
         // 1. Fetch Extension Config to get defined Permissions + tenant scope
         const { data: extData } = await supabase
            .from('extensions')
            .select('config, tenant_id')
            .eq('id', extensionId)
            .single();
         const definedPermNames = extData?.config?.permissions || [];
         const extensionTenantId = extData?.tenant_id || null;

         // 2. Fetch Roles scoped to the extension's tenant
         let rolesQuery = supabase
            .from('roles')
            .select('id, name, tenant_id')
            .is('deleted_at', null);

         if (extensionTenantId) {
            rolesQuery = rolesQuery.eq('tenant_id', extensionTenantId);
         } else {
            rolesQuery = rolesQuery.is('tenant_id', null);
         }

         const { data: rolesData } = await rolesQuery;
         setRoles(rolesData || []);

         setExtensionPermissions(definedPermNames);

         // 3. Fetch current mappings from REAL permissions table interactions
         if (definedPermNames.length > 0 && rolesData?.length > 0) {
            // Get permission IDs from core table
            const { data: corePerms } = await supabase
               .from('permissions')
               .select('id, name')
               .in('name', definedPermNames)
               .is('deleted_at', null);

            if (corePerms) {
               const permIdMap = {};
               corePerms.forEach(p => permIdMap[p.id] = p.name);
               const roleIds = rolesData.map(r => r.id);

               const { data: rolePerms } = await supabase
                  .from('role_permissions')
                  .select('role_id, permission_id')
                  .in('permission_id', corePerms.map(p => p.id))
                  .in('role_id', roleIds)
                  .is('deleted_at', null);

               const matrix = {};
               if (rolePerms) {
                  rolePerms.forEach(rp => {
                     if (!matrix[rp.role_id]) matrix[rp.role_id] = new Set();
                     const pName = permIdMap[rp.permission_id];
                     if (pName) matrix[rp.role_id].add(pName);
                  });
               }
               setActiveMatrix(matrix);
            }
         }

      } catch (error) {
         console.error(error);
      } finally {
         setLoading(false);
      }
   }, [extensionId]);

   useEffect(() => {
      fetchData();
   }, [fetchData]);

   const togglePermission = (roleId, permName) => {
      setActiveMatrix(prev => {
         const currentRolePerms = new Set(prev[roleId] || []);
         if (currentRolePerms.has(permName)) {
            currentRolePerms.delete(permName);
         } else {
            currentRolePerms.add(permName);
         }
         return { ...prev, [roleId]: currentRolePerms };
      });
   };

   const handleSave = async () => {
      try {
         setLoading(true);
         // 1. Get Core Permission IDs again to be safe
         const { data: corePerms } = await supabase
            .from('permissions')
            .select('id, name')
            .in('name', extensionPermissions)
            .is('deleted_at', null);

         if (!corePerms || corePerms.length === 0) {
            toast({ title: "No permissions to map", variant: "warning" });
            setLoading(false);
            return;
         }

         const nameToId = {};
         corePerms.forEach(p => nameToId[p.name] = p.id);
         const targetPermIds = corePerms.map(p => p.id);

         const roleIds = roles.map(r => r.id);
         if (roleIds.length === 0) {
            toast({ title: "No roles available", variant: "warning" });
            setLoading(false);
            return;
         }

         // 2. Clear existing mappings for these specific permissions scoped to the current tenant roles
         // We delete from role_permissions where permission_id and role_id match our target list
         await supabase
            .from('role_permissions')
            .update({ deleted_at: new Date().toISOString() })
            .in('permission_id', targetPermIds)
            .in('role_id', roleIds)
            .is('deleted_at', null);

         // 3. Insert new mappings
         const inserts = [];
         Object.entries(activeMatrix).forEach(([roleId, permSet]) => {
            permSet.forEach(permName => {
               if (nameToId[permName]) {
                  inserts.push({
                     role_id: roleId,
                     permission_id: nameToId[permName]
                  });
               }
            });
         });

         if (inserts.length > 0) {
            const payload = inserts.map(item => ({ ...item, deleted_at: null }));
            const { error } = await supabase
               .from('role_permissions')
               .upsert(payload, { onConflict: 'role_id, permission_id' });
            if (error) throw error;
         }

         toast({ title: t('common.success'), description: "Extension permissions updated for roles." });

      } catch (error) {
         console.error(error);
         toast({ variant: "destructive", title: t('common.error'), description: error.message });
      } finally {
         setLoading(false);
      }
   };

   if (loading) return <div>{t('common.loading')}</div>;

   return (
      <Card>
         <CardHeader>
            <CardTitle className="flex items-center gap-2">
               <Shield className="w-5 h-5 text-purple-600" />
               {t('extensions.abac')}
            </CardTitle>
            <CardDescription>Map extension permissions to system roles.</CardDescription>
         </CardHeader>
         <CardContent>
            {extensionPermissions.length === 0 ? (
               <div className="text-center py-8 text-slate-500">
                  This extension does not define any custom permissions.
               </div>
            ) : (
               <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                     <thead>
                        <tr>
                           <th className="text-left p-3 border-b font-medium text-slate-500">Permission</th>
                           {roles.map(role => (
                              <th key={role.id} className="text-center p-3 border-b font-medium text-slate-800 bg-slate-50">
                                 {role.name}
                              </th>
                           ))}
                        </tr>
                     </thead>
                     <tbody>
                        {extensionPermissions.map(permName => (
                           <tr key={permName} className="border-b last:border-0 hover:bg-slate-50/50">
                              <td className="p-3 font-mono text-xs text-slate-600">{permName}</td>
                              {roles.map(role => {
                                 const isChecked = activeMatrix[role.id]?.has(permName);
                                 return (
                                    <td key={`${role.id}-${permName}`} className="p-3 text-center">
                                       <button
                                          onClick={() => togglePermission(role.id, permName)}
                                          className={`w-6 h-6 rounded border flex items-center justify-center transition-colors ${isChecked
                                             ? 'bg-blue-600 border-blue-600 text-white'
                                             : 'bg-white border-slate-200 text-transparent hover:border-slate-300'
                                             }`}
                                       >
                                          <Check className="w-4 h-4" />
                                       </button>
                                    </td>
                                 );
                              })}
                           </tr>
                        ))}
                     </tbody>
                  </table>
                  <div className="mt-4 flex justify-end">
                     <Button onClick={handleSave} disabled={loading}>
                        <Save className="w-4 h-4 mr-2" />
                        {t('common.save')}
                     </Button>
                  </div>
               </div>
            )}
         </CardContent>
      </Card>
   );
}

export default ExtensionABACIntegration;
