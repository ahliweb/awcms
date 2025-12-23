
import React, { useState, useEffect } from 'react';
import {
  Box, Puzzle, Power, Trash2, Plus, Settings,
  Download, Upload, BookOpen, CheckCircle2, AlertCircle,
  Search, ExternalLink, Code, Activity, FileText, Shield
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { usePermissions } from '@/contexts/PermissionContext';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Badge } from '@/components/ui/badge';
import { useTranslation } from 'react-i18next';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { activateExtensionRegistry, deactivateExtensionRegistry, syncExtensionToRegistry } from '@/utils/extensionLifecycle';

// Extension Modules
import ExtensionEditor from './ExtensionEditor';
import ExtensionMarketplace from './ExtensionMarketplace';
import ExtensionGuide from './ExtensionGuide';
import ExtensionSettings from './ExtensionSettings';
import ExtensionLogs from './ExtensionLogs';
import ExtensionHealthCheck from './ExtensionHealthCheck';
import ExtensionRBACIntegration from './ExtensionRBACIntegration';
import ExtensionInstaller from './ExtensionInstaller';

function ExtensionsManager() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const { user } = useAuth();
  const { userRole, hasPermission, hasAnyPermission } = usePermissions();

  const [extensions, setExtensions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('installed');
  const [editingExtension, setEditingExtension] = useState(null);
  const [selectedForRBAC, setSelectedForRBAC] = useState(null);
  const [showGuide, setShowGuide] = useState(false);

  // RBAC & Permissions Logic
  const isSuperAdmin = ['super_admin', 'owner'].includes(userRole);
  const canCreate = isSuperAdmin || hasPermission('platform.module.create');
  const canManageGlobal = isSuperAdmin || hasPermission('platform.module.update');
  const canView = isSuperAdmin || hasAnyPermission(['platform.module.read', 'platform.module.update', 'platform.module.create']);

  useEffect(() => {
    if (canView) {
      fetchExtensions();
    } else {
      setLoading(false);
    }
  }, [canView]);

  const fetchExtensions = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('extensions')
        .select('*')
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

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
    // Only super admins should toggle activation state to prevent system breaking
    if (!isSuperAdmin) {
      toast({ variant: "destructive", title: t('common.access_denied'), description: "Only Super Admins can activate/deactivate extensions." });
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
    // Allow Super Admin or the specific Owner to delete
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
    <div className="flex flex-col items-center justify-center min-h-[400px] bg-white rounded-xl border border-slate-200 p-12 text-center">
      <div className="p-4 bg-red-50 rounded-full mb-4">
        <AlertCircle className="w-12 h-12 text-red-500" />
      </div>
      <h3 className="text-xl font-bold text-slate-800">{t('common.access_denied')}</h3>
      <p className="text-slate-500 mt-2">{t('common.permission_required')}</p>
    </div>
  );

  if (showGuide) return <ExtensionGuide onBack={() => setShowGuide(false)} />;
  if (editingExtension) return <ExtensionEditor extension={editingExtension} onClose={() => setEditingExtension(null)} onSave={() => { setEditingExtension(null); fetchExtensions(); }} />;

  return (
    <div className="space-y-6">
      {/* Breadcrumb Navigation */}
      <nav className="flex items-center text-sm text-slate-500">
        <a href="/cmspanel" className="hover:text-blue-600 transition-colors flex items-center gap-1">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
          Dashboard
        </a>
        <svg className="w-4 h-4 mx-2 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        <span className="flex items-center gap-1 text-slate-700 font-medium">
          <Puzzle className="w-4 h-4" />
          Extensions
        </span>
      </nav>

      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold text-slate-800 flex items-center gap-2">
            <Puzzle className="w-8 h-8 text-blue-600" />
            {t('extensions.title')}
          </h2>
          <p className="text-slate-600">{t('extensions.subtitle')}</p>
        </div>
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
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="bg-white p-1 border border-slate-200 rounded-lg overflow-x-auto flex-wrap h-auto w-full justify-start">
          <TabsTrigger value="installed">{t('extensions.installed')} ({extensions.length})</TabsTrigger>
          {canCreate && <TabsTrigger value="install">{t('extensions.install')}</TabsTrigger>}
          <TabsTrigger value="marketplace">{t('extensions.marketplace')}</TabsTrigger>
          {canManageGlobal && <TabsTrigger value="settings">{t('extensions.settings')}</TabsTrigger>}
          {canManageGlobal && <TabsTrigger value="health">{t('extensions.health')}</TabsTrigger>}
          {canManageGlobal && <TabsTrigger value="logs">{t('extensions.logs')}</TabsTrigger>}
          {canManageGlobal && <TabsTrigger value="rbac" className="flex gap-2"><Shield className="w-4 h-4" /> {t('extensions.rbac')}</TabsTrigger>}
        </TabsList>

        <TabsContent value="installed" className="space-y-4 mt-4">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input placeholder={t('common.search')} value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9" />
            </div>
          </div>

          {loading ? (
            <div className="text-center py-12 text-slate-500">{t('common.loading')}</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {filteredExtensions.map((ext) => {
                const isOwner = user?.id === ext.created_by;
                const canManageThis = isSuperAdmin || isOwner;

                return (
                  <div key={ext.id} className={`bg-white rounded-xl border shadow-sm flex flex-col ${ext.is_active ? 'border-blue-200 ring-1 ring-blue-100' : 'border-slate-200'}`}>
                    <div className="p-5 flex-1">
                      <div className="flex justify-between items-start mb-4">
                        <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center text-xl">{ext.icon || <Puzzle />}</div>
                        <Badge variant={ext.is_active ? "default" : "secondary"}>{ext.is_active ? t('extensions.status_active') : t('extensions.status_inactive')}</Badge>
                      </div>
                      <h3 className="text-lg font-bold text-slate-800 mb-1">{ext.name}</h3>
                      <p className="text-sm text-slate-500 line-clamp-2 mb-3">{ext.description}</p>
                      <div className="flex flex-wrap gap-1">
                        {ext.config?.routes?.length > 0 && <span className="text-[10px] bg-slate-50 px-1 rounded text-slate-500">{ext.config.routes.length} Routes</span>}
                        {ext.config?.menus?.length > 0 && <span className="text-[10px] bg-slate-50 px-1 rounded text-slate-500">{ext.config.menus.length} Menus</span>}
                      </div>
                      {isOwner && <span className="mt-2 inline-block text-[10px] text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full font-medium">Your Extension</span>}
                    </div>

                    <div className="p-4 border-t border-slate-100 bg-slate-50/50 rounded-b-xl flex justify-between items-center">
                      <div className="flex gap-1">
                        {canManageThis && (
                          <Button variant="ghost" size="sm" onClick={() => setEditingExtension(ext)} title={t('extensions.configure')}><Settings className="w-4 h-4" /></Button>
                        )}
                        {canManageGlobal && (
                          <Button variant="ghost" size="sm" onClick={() => { setSelectedForRBAC(ext); setActiveTab('rbac'); }} title={t('extensions.permissions')}><Shield className="w-4 h-4" /></Button>
                        )}
                        {canManageThis && (
                          <Button variant="ghost" size="sm" onClick={() => handleDelete(ext)} className="text-red-500 hover:text-red-600 hover:bg-red-50"><Trash2 className="w-4 h-4" /></Button>
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
                  <ExtensionRBACIntegration extensionId={selectedForRBAC.id} />
                </div>
              ) : (
                <div className="text-center py-12 border border-dashed rounded-xl">
                  <Shield className="w-12 h-12 mx-auto text-slate-300 mb-3" />
                  <h3 className="text-lg font-medium text-slate-900">{t('extensions.select_extension')}</h3>
                  <p className="text-slate-500">Go to the "Installed" tab and click the Shield icon on an extension card.</p>
                </div>
              )}
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}

export default ExtensionsManager;
