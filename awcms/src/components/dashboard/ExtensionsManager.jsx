
import { useState, useEffect, useCallback } from 'react';
import {
  Puzzle,
  Upload,
  BookOpen,
  AlertCircle,
  Shield,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { usePermissions } from '@/contexts/PermissionContext';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { useTranslation } from 'react-i18next';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { listTenantExtensions } from '@/lib/extensionCatalog';
import { activateTenantExtension, deactivateTenantExtension, uninstallTenantExtension } from '@/lib/extensionLifecycleApi';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';
import { cn } from '@/lib/utils';

// Extension Modules
import ExtensionEditor from './ExtensionEditor';
import ExtensionMarketplace from './ExtensionMarketplace';
import ExtensionGuide from './ExtensionGuide';
import ExtensionSettings from './ExtensionSettings';
import ExtensionLogs from './ExtensionLogs';
import ExtensionHealthCheck from './ExtensionHealthCheck';
import ExtensionInstaller from './ExtensionInstaller';
import ExtensionsOverviewCards from '@/components/dashboard/extensions/ExtensionsOverviewCards';
import ExtensionsInstalledTab from '@/components/dashboard/extensions/ExtensionsInstalledTab';
import ExtensionsRbacTab from '@/components/dashboard/extensions/ExtensionsRbacTab';
import ExtensionDeleteDialog from '@/components/dashboard/extensions/ExtensionDeleteDialog';

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
  const [extensionToDelete, setExtensionToDelete] = useState(null);

  // RBAC & Permissions Logic
  const isSuperAdmin = isPlatformAdmin || isFullAccess;
  const canCreate = isSuperAdmin || hasPermission('platform.extensions.create');
  const canManageGlobal = isSuperAdmin || hasPermission('platform.extensions.update');
  const canView = isSuperAdmin || hasAnyPermission(['platform.extensions.read', 'platform.extensions.update', 'platform.extensions.create']);

  const fetchExtensions = useCallback(async () => {
    try {
      setLoading(true);
      const data = await listTenantExtensions({ tenantId: currentTenant?.id || null });
      setExtensions(data || []);
    } catch (error) {
      console.error('Error fetching extensions:', error);
      toast({ variant: "destructive", title: t('common.error'), description: "Failed to load extensions" });
    } finally {
      setLoading(false);
    }
  }, [currentTenant?.id, t, toast]);

  useEffect(() => {
    if (canView) {
      fetchExtensions();
    } else {
      setLoading(false);
    }
  }, [canView, fetchExtensions]);

  const handleToggleStatus = async (ext) => {
    // Only platform admins should toggle activation state to prevent system breaking
    if (!isSuperAdmin) {
      toast({ variant: "destructive", title: t('common.access_denied'), description: "Only platform admins can activate/deactivate extensions." });
      return;
    }

    try {
      const newStatus = !ext.is_active;

      if (newStatus) {
        await activateTenantExtension({ tenantExtensionId: ext.id, tenantId: ext.tenant_id || currentTenant?.id || null });
      } else {
        await deactivateTenantExtension({ tenantExtensionId: ext.id, tenantId: ext.tenant_id || currentTenant?.id || null });
      }

      toast({ title: newStatus ? t('extensions.activate') : t('extensions.deactivate'), description: `${ext.name} is now ${newStatus ? 'active' : 'inactive'}.` });
      setExtensions(extensions.map(e => e.id === ext.id ? { ...e, is_active: newStatus } : e));

    } catch (error) {
      toast({ variant: "destructive", title: t('common.error'), description: error.message });
    }
  };

  const handleDelete = (ext) => {
    const isOwner = user?.id === ext.created_by;
    if (!isSuperAdmin && !isOwner) {
      toast({ variant: "destructive", title: t('common.access_denied'), description: "You can only delete extensions you created." });
      return;
    }
    setExtensionToDelete(ext);
  };

  const handleConfirmDelete = async () => {
    if (!extensionToDelete) return;
    try {
      await uninstallTenantExtension({ tenantExtensionId: extensionToDelete.id, tenantId: extensionToDelete.tenant_id || currentTenant?.id || null });

      toast({ title: t('common.success'), description: "Extension deleted" });
      fetchExtensions();
    } catch (e) {
      toast({ variant: "destructive", title: t('common.error'), description: e.message });
    } finally {
      setExtensionToDelete(null);
    }
  };

  const filteredExtensions = extensions.filter(ext =>
    ext.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    ext.description?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const activeExtensionsCount = extensions.filter((ext) => ext.is_active).length;
  const ownedExtensionsCount = extensions.filter((ext) => ext.created_by === user?.id).length;
  const searchActive = Boolean(searchTerm.trim());

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
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        onClick={fetchExtensions}
        disabled={loading}
        className="h-10 rounded-xl border-border/70 bg-background/80 px-3 text-muted-foreground shadow-sm hover:bg-accent/70 hover:text-foreground"
      >
        <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
        {t('common.refresh')}
      </Button>

      <Button variant="outline" onClick={() => setShowGuide(true)} className="h-10 rounded-xl border-border/70 bg-background/80 px-3 text-muted-foreground shadow-sm hover:bg-accent/70 hover:text-foreground">
        <BookOpen className="mr-2 h-4 w-4" />
        {t('extensions.guide')}
      </Button>
      {canCreate && (
        <Button onClick={() => setActiveTab('install')} className="h-10 rounded-xl bg-primary px-4 text-primary-foreground shadow-sm hover:opacity-95">
          <Upload className="mr-2 h-4 w-4" />
          {t('extensions.install')}
        </Button>
      )}
    </div>
  );

  return (
    <AdminPageLayout className="space-y-6">
      <PageHeader
        title={t('extensions.title')}
        description={t('extensions.subtitle')}
        breadcrumbs={breadcrumbs}
        actions={headerActions}
      />

      <ExtensionsOverviewCards
        extensionsCount={extensions.length}
        activeExtensionsCount={activeExtensionsCount}
        ownedExtensionsCount={ownedExtensionsCount}
        searchActive={searchActive}
        searchTerm={searchTerm}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 rounded-xl border border-border/60 bg-card/75 p-1">
          <TabsTrigger value="installed" className="rounded-lg data-[state=active]:bg-primary/10 data-[state=active]:text-primary">{t('extensions.installed')} ({extensions.length})</TabsTrigger>
          {canCreate && <TabsTrigger value="install" className="rounded-lg data-[state=active]:bg-primary/10 data-[state=active]:text-primary">{t('extensions.install')}</TabsTrigger>}
          <TabsTrigger value="marketplace" className="rounded-lg data-[state=active]:bg-primary/10 data-[state=active]:text-primary">{t('extensions.marketplace')}</TabsTrigger>
          {canManageGlobal && <TabsTrigger value="settings" className="rounded-lg data-[state=active]:bg-primary/10 data-[state=active]:text-primary">{t('extensions.settings')}</TabsTrigger>}
          {canManageGlobal && <TabsTrigger value="health" className="rounded-lg data-[state=active]:bg-primary/10 data-[state=active]:text-primary">{t('extensions.health')}</TabsTrigger>}
          {canManageGlobal && <TabsTrigger value="logs" className="rounded-lg data-[state=active]:bg-primary/10 data-[state=active]:text-primary">{t('extensions.logs')}</TabsTrigger>}
          {canManageGlobal && <TabsTrigger value="rbac" className="flex gap-2 rounded-lg data-[state=active]:bg-primary/10 data-[state=active]:text-primary"><Shield className="w-4 h-4" /> {t('extensions.abac')}</TabsTrigger>}
        </TabsList>

        <TabsContent value="installed" className="mt-6">
          <ExtensionsInstalledTab
            t={t}
            loading={loading}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            searchActive={searchActive}
            extensions={extensions}
            filteredExtensions={filteredExtensions}
            user={user}
            isSuperAdmin={isSuperAdmin}
            canManageGlobal={canManageGlobal}
            onEdit={setEditingExtension}
            onDelete={handleDelete}
            onToggleStatus={handleToggleStatus}
            onSelectRbac={(extension) => {
              setSelectedForRBAC(extension);
              setActiveTab('rbac');
            }}
            onRefresh={fetchExtensions}
          />
        </TabsContent>

        {canCreate && (
          <TabsContent value="install" className="mt-6">
            <div>
              <ExtensionInstaller onInstallComplete={() => { setActiveTab('installed'); fetchExtensions(); }} />
            </div>
          </TabsContent>
        )}

        <TabsContent value="marketplace" className="mt-6"><ExtensionMarketplace onInstall={() => { setActiveTab('installed'); fetchExtensions(); }} /></TabsContent>

        {canManageGlobal && (
          <>
            <TabsContent value="settings" className="mt-6"><ExtensionSettings /></TabsContent>
            <TabsContent value="health" className="mt-6"><ExtensionHealthCheck /></TabsContent>
            <TabsContent value="logs" className="mt-6"><ExtensionLogs /></TabsContent>
            <TabsContent value="rbac" className="mt-6">
              <ExtensionsRbacTab
                t={t}
                selectedForRBAC={selectedForRBAC}
                onBack={() => setSelectedForRBAC(null)}
              />
            </TabsContent>
          </>
        )}
      </Tabs>

      <ExtensionDeleteDialog
        t={t}
        extension={extensionToDelete}
        onOpenChange={(open) => !open && setExtensionToDelete(null)}
        onConfirm={handleConfirmDelete}
      />
    </AdminPageLayout>
  );
}

export default ExtensionsManager;
