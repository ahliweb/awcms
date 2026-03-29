
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Shield, Check, Save, Crown, Layers3, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useTranslation } from 'react-i18next';
import { listTenantExtensions } from '@/lib/extensionCatalog';
import { useTenant } from '@/contexts/TenantContext';
import { usePermissions } from '@/contexts/PermissionContext';
import useSecureRouteParam from '@/hooks/useSecureRouteParam';

function ExtensionABACIntegration({ extensionId, extension = null }) {
   const { toast } = useToast();
   const { t } = useTranslation();
   const { currentTenant } = useTenant();
   const { isPlatformAdmin } = usePermissions();
   const { value: secureExtensionId } = useSecureRouteParam(extensionId, 'extensions.abac');
   const resolvedExtensionId = secureExtensionId || extensionId;
   const [roles, setRoles] = useState([]);
   const [platformRoles, setPlatformRoles] = useState([]);
   const [extensionPermissions, setExtensionPermissions] = useState([]);
   const [activeMatrix, setActiveMatrix] = useState({}); // { roleId: Set(permNames) }
   const [loading, setLoading] = useState(true);
   const [platformRolesPage, setPlatformRolesPage] = useState(1);
   const [platformRolesPerPage, setPlatformRolesPerPage] = useState(6);
   const [resolvedExtension, setResolvedExtension] = useState(extension);

   const platformRoleIds = useMemo(() => platformRoles.map((role) => role.id), [platformRoles]);
   const tenantRoles = useMemo(() => roles.filter((role) => !platformRoleIds.includes(role.id)), [roles, platformRoleIds]);
   const platformRolesTotalPages = Math.max(1, Math.ceil(platformRoles.length / platformRolesPerPage));
   const paginatedPlatformRoles = useMemo(() => {
      const from = (platformRolesPage - 1) * platformRolesPerPage;
      return platformRoles.slice(from, from + platformRolesPerPage);
   }, [platformRoles, platformRolesPage, platformRolesPerPage]);

   const fetchData = useCallback(async () => {
      setLoading(true);
      try {
         const extensions = await listTenantExtensions({ tenantId: currentTenant?.id || null });
         const extData = extension || extensions.find((entry) => entry.id === resolvedExtensionId);
         const definedPermNames = (extData?.manifest?.permissions || []).map((permission) => permission.key || permission);
         const extensionTenantId = extData?.tenant_id || currentTenant?.id || null;

         setResolvedExtension(extData || null);

         if (!extData) {
            setRoles([]);
            setPlatformRoles([]);
            setExtensionPermissions([]);
            setActiveMatrix({});
            return;
         }

         let rolesQuery = supabase
             .from('roles')
             .select('id, name, description, tenant_id, scope, is_platform_admin, is_full_access, created_at')
             .is('deleted_at', null);

         if (extensionTenantId) {
            rolesQuery = rolesQuery.or(`tenant_id.eq.${extensionTenantId},scope.eq.platform,is_platform_admin.eq.true,is_full_access.eq.true,tenant_id.is.null`);
         } else {
            rolesQuery = rolesQuery.or('scope.eq.platform,is_platform_admin.eq.true,is_full_access.eq.true,tenant_id.is.null');
         }

         const { data: rolesData, error: rolesError } = await rolesQuery.order('name');
         if (rolesError) throw rolesError;

         const roleRows = rolesData || [];
         const elevatedRoles = roleRows.filter((role) => role.scope === 'platform' || role.is_platform_admin || role.is_full_access || role.tenant_id == null);

         setRoles(roleRows);
         setPlatformRoles(elevatedRoles);

         setExtensionPermissions(definedPermNames);

         if (definedPermNames.length > 0 && roleRows.length > 0) {
            const { data: corePerms } = await supabase
               .from('permissions')
               .select('id, name')
               .in('name', definedPermNames)
               .is('deleted_at', null);

            if (corePerms) {
               const permIdMap = {};
               corePerms.forEach(p => permIdMap[p.id] = p.name);
               const roleIds = roleRows.map(r => r.id);

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
          toast({ variant: 'destructive', title: t('common.error'), description: error.message || 'Failed to load extension ABAC data.' });
       } finally {
          setLoading(false);
       }
   }, [currentTenant?.id, extension, resolvedExtensionId, t, toast]);

   useEffect(() => {
      fetchData();
   }, [fetchData]);

   useEffect(() => {
      setPlatformRolesPage(1);
   }, [resolvedExtensionId]);

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

         toast({ title: t('common.success'), description: 'Extension permissions updated for platform and tenant roles.' });

      } catch (error) {
         console.error(error);
         toast({ variant: "destructive", title: t('common.error'), description: error.message });
      } finally {
         setLoading(false);
      }
   };

   if (loading) return <div>{t('common.loading')}</div>;

   const renderPermissionsMatrix = (roleSet, emptyMessage) => {
      if (roleSet.length === 0) {
         return (
            <div className="rounded-2xl border border-dashed border-border/70 bg-card/55 py-10 text-center text-sm text-muted-foreground">
               {emptyMessage}
            </div>
         );
      }

      return (
         <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
               <thead>
                  <tr>
                     <th className="border-b border-border/60 p-3 text-left font-medium text-muted-foreground">Permission</th>
                     {roleSet.map((role) => (
                        <th key={role.id} className="border-b border-border/60 bg-card/60 p-3 text-center font-medium text-foreground">
                           <div className="space-y-1">
                              <div className="flex items-center justify-center gap-1">
                                 {(role.scope === 'platform' || role.is_platform_admin || role.is_full_access || role.tenant_id == null) ? <Crown className="h-3.5 w-3.5 text-amber-500" /> : null}
                                 <span>{role.name}</span>
                              </div>
                              <p className="text-[10px] font-normal text-muted-foreground">
                                 {role.tenant_id ? 'Tenant role' : 'Platform role'}
                              </p>
                           </div>
                        </th>
                     ))}
                  </tr>
               </thead>
               <tbody>
                  {extensionPermissions.map((permName) => (
                     <tr key={permName} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                        <td className="p-3 font-mono text-xs text-muted-foreground">{permName}</td>
                        {roleSet.map((role) => {
                           const isChecked = activeMatrix[role.id]?.has(permName);
                           return (
                              <td key={`${role.id}-${permName}`} className="p-3 text-center">
                                 <button
                                    onClick={() => togglePermission(role.id, permName)}
                                    className={`flex h-6 w-6 items-center justify-center rounded border transition-colors ${isChecked
                                       ? 'border-primary bg-primary text-primary-foreground'
                                       : 'border-border/70 bg-background text-transparent hover:border-primary/40'
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
         </div>
      );
   };

   return (
      <Card className="border-border/60 bg-card/75">
         <CardHeader>
            <CardTitle className="flex items-center gap-2">
               <Shield className="h-5 w-5 text-primary" />
               {t('extensions.abac')}
            </CardTitle>
            <CardDescription>{t('extensions.abac_description')}</CardDescription>
         </CardHeader>
         <CardContent>
            {extensionPermissions.length === 0 ? (
               <div className="py-8 text-center text-muted-foreground">
                   {t('extensions.no_custom_permissions')}
               </div>
            ) : (
               <div className="space-y-6">
                  <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                     <span className="inline-flex items-center gap-2 rounded-full bg-background/70 px-3 py-1.5 shadow-sm">
                        <Layers3 className="h-4 w-4 text-primary" />
                        {t('extensions.abac_refresh_safe')}
                     </span>
                     <span className="inline-flex items-center gap-2 rounded-full bg-background/70 px-3 py-1.5 shadow-sm">
                        <ShieldCheck className="h-4 w-4 text-emerald-600" />
                        {t('extensions.abac_role_separation')}
                     </span>
                     {resolvedExtension?.name ? (
                        <Badge variant="secondary" className="rounded-full border border-border/70 bg-background/80 px-3 py-1 text-xs font-medium shadow-sm">
                           {resolvedExtension.name}
                        </Badge>
                     ) : null}
                  </div>

                  {isPlatformAdmin ? (
                     <div className="space-y-4 rounded-2xl border border-border/60 bg-card/70 p-5 shadow-sm backdrop-blur-sm">
                        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                           <div>
                               <h3 className="text-lg font-semibold text-foreground">{t('extensions.platform_scope_roles')}</h3>
                               <p className="text-sm text-muted-foreground">{t('extensions.platform_scope_roles_hint')}</p>
                           </div>
                           <div className="inline-flex items-center rounded-full border border-border/70 bg-background/70 px-3 py-1.5 text-xs font-medium text-muted-foreground">
                               {t('extensions.platform_scope_roles_count', { count: platformRoles.length })}
                           </div>
                        </div>

                        {renderPermissionsMatrix(paginatedPlatformRoles, t('extensions.no_platform_roles'))}

                        <div className="flex flex-col gap-3 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
                           <div className="text-sm text-muted-foreground">
                               {t('extensions.platform_roles_pagination', {
                                  from: paginatedPlatformRoles.length === 0 ? 0 : ((platformRolesPage - 1) * platformRolesPerPage) + 1,
                                  to: Math.min(platformRolesPage * platformRolesPerPage, platformRoles.length),
                                  total: platformRoles.length,
                               })}
                           </div>
                           <div className="flex flex-wrap items-center gap-2">
                              <select
                                 value={platformRolesPerPage}
                                 onChange={(event) => {
                                    setPlatformRolesPerPage(Number(event.target.value));
                                    setPlatformRolesPage(1);
                                 }}
                                 className="h-10 rounded-xl border border-border/70 bg-background px-3 text-sm text-foreground shadow-sm"
                              >
                                 {[3, 6, 9, 12].map((value) => (
                                     <option key={value} value={value}>{t('extensions.roles_per_page', { count: value })}</option>
                                 ))}
                              </select>
                              <Button variant="outline" className="rounded-xl" disabled={platformRolesPage <= 1} onClick={() => setPlatformRolesPage((page) => Math.max(1, page - 1))}>
                                 {t('common.previous')}
                              </Button>
                               <span className="px-2 text-sm text-muted-foreground">{t('common.page_of', { page: platformRolesPage, total: platformRolesTotalPages })}</span>
                              <Button variant="outline" className="rounded-xl" disabled={platformRolesPage >= platformRolesTotalPages} onClick={() => setPlatformRolesPage((page) => Math.min(platformRolesTotalPages, page + 1))}>
                                 {t('common.next')}
                              </Button>
                           </div>
                        </div>
                     </div>
                  ) : null}

                  <div className="space-y-2">
                     <div className="flex items-center justify-between px-1">
                         <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t('extensions.tenant_role_management')}</p>
                         <p className="text-xs text-muted-foreground">{currentTenant?.name || t('extensions.current_tenant')}</p>
                     </div>
                  </div>

                   {renderPermissionsMatrix(tenantRoles, t('extensions.no_tenant_roles'))}

                  <div className="mt-4 flex justify-end">
                     <Button onClick={handleSave} disabled={loading} className="rounded-xl bg-primary text-primary-foreground hover:opacity-95">
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
