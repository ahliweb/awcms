
import React, { useState, useEffect } from 'react';
import {
  Puzzle, Power, Trash2, Settings,
  Upload, BookOpen, AlertCircle,
  Search, Shield
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { usePermissions } from '@/contexts/PermissionContext';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { Badge } from '@/components/ui/badge';
import { useTranslation } from 'react-i18next';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { activateExtensionRegistry, deactivateExtensionRegistry, syncExtensionToRegistry } from '@/utils/extensionLifecycle';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';

// Extension Modules
import ExtensionEditor from './ExtensionEditor';
import ExtensionMarketplace from './ExtensionMarketplace';
import ExtensionGuide from './ExtensionGuide';
import ExtensionSettings from './ExtensionSettings';
import ExtensionLogs from './ExtensionLogs';
import ExtensionHealthCheck from './ExtensionHealthCheck';
import ExtensionABACIntegration from './ExtensionABACIntegration';
import ExtensionInstaller from './ExtensionInstaller';

function ExtensionsManager() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const { user } = useAuth();
  const { hasPermission, hasAnyPermission, isPlatformAdmin, isFullAccess } = usePermissions();
  const { currentTenant } = useTenant();

  const [extensions, setExtensions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('installed');
  const [editingExtension, setEditingExtension] = useState(null);
  const [selectedForRBAC, setSelectedForRBAC] = useState(null);
  const [showGuide, setShowGuide] = useState(false);

  // RBAC & Permissions Logic
  const isSuperAdmin = isPlatformAdmin || isFullAccess;
  const canCreate = isSuperAdmin || hasPermission('platform.extensions.create');
  const canManageGlobal = isSuperAdmin || hasPermission('platform.extensions.update');
  const canView = isSuperAdmin || hasAnyPermission(['platform.extensions.read', 'platform.extensions.update', 'platform.extensions.create']);

  useEffect(() => {
    if (canView) {
      fetchExtensions();
    } else {
      setLoading(false);
    }
  }, [canView, currentTenant?.id, isPlatformAdmin]);

  const fetchExtensions = async () => {
    try {
      setLoading(true);
      let query = supabase
        .from('extensions')
        .select('*')
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (!isPlatformAdmin && currentTenant?.id) {
        query = query.eq('tenant_id', currentTenant.id);
      }

      const { data, error } = await query;

      if (error) throw error;
      setExtensions(data || []);
    } catch (error) {
      console.error('Error fetching extensions:', error);
      toast({ variant: "destructive", title: t('common.error'), description: "Failed to load extensions" });
    } finally {
      setLoading(false);
    }
  };

  const handleToggleStatus = async (ext) => {
    // Only platform admins should toggle activation state to prevent system breaking
    if (!isSuperAdmin) {
      toast({ variant: "destructive", title: t('common.access_denied'), description: "Only platform admins can activate/deactivate extensions." });
      return;
    }

    try {
      const newStatus = !ext.is_active;

      const { error } = await supabase.from('extensions').update({ is_active: newStatus, updated_at: new Date().toISOString() }).eq('id', ext.id);
      if (error) throw error;

      if (newStatus) {
        await activateExtensionRegistry(ext.id);
        await syncExtensionToRegistry(ext.id, ext.config);
      } else {
        await deactivateExtensionRegistry(ext.id);
      }

      toast({ title: newStatus ? t('extensions.activate') : t('extensions.deactivate'), description: `${ext.name} is now ${newStatus ? 'active' : 'inactive'}.` });
      setExtensions(extensions.map(e => e.id === ext.id ? { ...e, is_active: newStatus } : e));

    } catch (error) {
      toast({ variant: "destructive", title: t('common.error'), description: error.message });
    }
  };

  const handleDelete = async (ext) => {
    // Allow platform admin or the specific Owner to delete
    const isOwner = user?.id === ext.created_by;

    if (!isSuperAdmin && !isOwner) {
      toast({ variant: "destructive", title: t('common.access_denied'), description: "You can only delete extensions you created." });
      return;
    }

    if (!window.confirm(t('extensions.delete_confirm'))) return;

    try {
      // Soft delete
      await supabase.from('extensions').update({ deleted_at: new Date().toISOString() }).eq('id', ext.id);
      await deactivateExtensionRegistry(ext.id);

      toast({ title: t('common.success'), description: "Extension deleted" });
      fetchExtensions();
    } catch (e) {
      toast({ variant: "destructive", title: t('common.error'), description: e.message });
    }
  };

  const filteredExtensions = extensions.filter(ext =>
    ext.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    ext.description?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!canView) return (
    <div className="flex flex-col items-center justify-center min-h-[400px] bg-card rounded-xl border border-border p-12 text-center">
      <div className="p-4 bg-destructive/10 rounded-full mb-4">
        <AlertCircle className="w-12 h-12 text-destructive" />
      </div>
      <h3 className="text-xl font-bold text-foreground">{t('common.access_denied')}</h3>
      <p className="text-muted-foreground mt-2">{t('common.permission_required')}</p>
    </div>
  );

  if (showGuide) return <ExtensionGuide onBack={() => setShowGuide(false)} />;
  if (editingExtension) return <ExtensionEditor extension={editingExtension} onClose={() => setEditingExtension(null)} onSave={() => { setEditingExtension(null); fetchExtensions(); }} />;

  const breadcrumbs = [
    { label: t('extensions.title'), icon: Puzzle }
  ];

  const headerActions = (
    <div className="flex gap-2">
      <Button variant="outline" onClick={() => setShowGuide(true)}>
        <BookOpen className="w-4 h-4 mr-2" />
        {t('extensions.guide')}
      </Button>
      {canCreate && (
        <Button onClick={() => setActiveTab('install')}>
          <Upload className="w-4 h-4 mr-2" />
          {t('extensions.install')}
        </Button>
      )}
    </div>
  );

  return (
    <AdminPageLayout>
      <PageHeader
        title={t('extensions.title')}
        description={t('extensions.subtitle')}
        breadcrumbs={breadcrumbs}
        actions={headerActions}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="bg-muted p-1 rounded-lg overflow-x-auto flex-wrap h-auto w-full justify-start">
          <TabsTrigger value="installed">{t('extensions.installed')} ({extensions.length})</TabsTrigger>
          {canCreate && <TabsTrigger value="install">{t('extensions.install')}</TabsTrigger>}
          <TabsTrigger value="marketplace">{t('extensions.marketplace')}</TabsTrigger>
          {canManageGlobal && <TabsTrigger value="settings">{t('extensions.settings')}</TabsTrigger>}
          {canManageGlobal && <TabsTrigger value="health">{t('extensions.health')}</TabsTrigger>}
          {canManageGlobal && <TabsTrigger value="logs">{t('extensions.logs')}</TabsTrigger>}
          {canManageGlobal && <TabsTrigger value="rbac" className="flex gap-2"><Shield className="w-4 h-4" /> {t('extensions.abac')}</TabsTrigger>}
        </TabsList>

        <TabsContent value="installed" className="space-y-4 mt-4">
          <div className="bg-card p-4 rounded-xl border border-border shadow-sm">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder={t('common.search')} value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9 bg-background border-input" />
            </div>
          </div>

          {loading ? (
            <div className="text-center py-12 text-muted-foreground">{t('common.loading')}</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {filteredExtensions.map((ext) => {
                const isOwner = user?.id === ext.created_by;
                const canManageThis = isSuperAdmin || isOwner;

                return (
                  <div key={ext.id} className={`bg-card rounded-xl border shadow-sm flex flex-col ${ext.is_active ? 'border-primary/20 ring-1 ring-primary/10' : 'border-border'}`}>
                    <div className="p-5 flex-1">
                      <div className="flex justify-between items-start mb-4">
                        <div className="w-10 h-10 bg-muted rounded-lg flex items-center justify-center text-xl text-foreground">{ext.icon || <Puzzle />}</div>
                        <Badge variant={ext.is_active ? "default" : "secondary"}>{ext.is_active ? t('extensions.status_active') : t('extensions.status_inactive')}</Badge>
                      </div>
                      <h3 className="text-lg font-bold text-foreground mb-1">{ext.name}</h3>
                      <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{ext.description}</p>
                      <div className="flex flex-wrap gap-1">
                        {ext.config?.routes?.length > 0 && <span className="text-[10px] bg-muted px-1 rounded text-muted-foreground">{ext.config.routes.length} Routes</span>}
                        {ext.config?.menus?.length > 0 && <span className="text-[10px] bg-muted px-1 rounded text-muted-foreground">{ext.config.menus.length} Menus</span>}
                      </div>
                      {isOwner && <span className="mt-2 inline-block text-[10px] text-primary bg-primary/10 px-2 py-0.5 rounded-full font-medium border border-primary/20">Your Extension</span>}
                    </div>

                    <div className="p-4 border-t border-border bg-muted/20 rounded-b-xl flex justify-between items-center">
                      <div className="flex gap-1">
                        {canManageThis && (
                          <Button variant="ghost" size="sm" onClick={() => setEditingExtension(ext)} title={t('extensions.configure')} className="text-muted-foreground hover:text-foreground"><Settings className="w-4 h-4" /></Button>
                        )}
                        {canManageGlobal && (
                          <Button variant="ghost" size="sm" onClick={() => { setSelectedForRBAC(ext); setActiveTab('rbac'); }} title={t('extensions.permissions')} className="text-muted-foreground hover:text-foreground"><Shield className="w-4 h-4" /></Button>
                        )}
                        {canManageThis && (
                          <Button variant="ghost" size="sm" onClick={() => handleDelete(ext)} className="text-destructive hover:text-destructive hover:bg-destructive/10"><Trash2 className="w-4 h-4" /></Button>
                        )}
                      </div>

                      {isSuperAdmin && (
                        <Button size="sm" variant={ext.is_active ? "outline" : "default"} onClick={() => handleToggleStatus(ext)}>
                          <Power className="w-3 h-3 mr-2" /> {ext.is_active ? t('extensions.deactivate') : t('extensions.activate')}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {canCreate && (
          <TabsContent value="install">
            <div className="max-w-2xl mx-auto mt-8">
              <ExtensionInstaller onInstallComplete={() => { setActiveTab('installed'); fetchExtensions(); }} />
            </div>
          </TabsContent>
        )}

        <TabsContent value="marketplace"><ExtensionMarketplace onInstall={() => { setActiveTab('installed'); fetchExtensions(); }} /></TabsContent>

        {canManageGlobal && (
          <>
            <TabsContent value="settings"><ExtensionSettings /></TabsContent>
            <TabsContent value="health"><ExtensionHealthCheck /></TabsContent>
            <TabsContent value="logs"><ExtensionLogs /></TabsContent>
            <TabsContent value="rbac">
              {selectedForRBAC ? (
                <div className="space-y-4">
                  <Button variant="outline" onClick={() => setSelectedForRBAC(null)} className="mb-4">{t('common.back')}</Button>
                  <h3 className="text-xl font-bold">Managing RBAC for {selectedForRBAC.name}</h3>
                  <ExtensionABACIntegration extensionId={selectedForRBAC.id} />
                </div>
              ) : (
                <div className="text-center py-12 border border-dashed border-border rounded-xl">
                  <Shield className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                  <h3 className="text-lg font-medium text-foreground">{t('extensions.select_extension')}</h3>
                  <p className="text-muted-foreground">Go to the "Installed" tab and click the Shield icon on an extension card.</p>
                </div>
              )}
            </TabsContent>
          </>
        )}
      </Tabs>
    </AdminPageLayout>
  );
}

export default ExtensionsManager;
