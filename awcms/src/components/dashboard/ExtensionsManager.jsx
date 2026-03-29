
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Puzzle,
  Upload,
  BookOpen,
  AlertCircle,
  Shield,
  RefreshCw,
  ChevronRight,
  Home,
  Layers3,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { usePermissions } from '@/contexts/PermissionContext';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { useTranslation } from 'react-i18next';
import useSplatSegments from '@/hooks/useSplatSegments';
import { listTenantExtensions } from '@/lib/extensionCatalog';
import { activateTenantExtension, deactivateTenantExtension, uninstallTenantExtension } from '@/lib/extensionLifecycleApi';
import { encodeRouteParam } from '@/lib/routeSecurity';
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
import ExtensionsAbacTab from '@/components/dashboard/extensions/ExtensionsAbacTab';
import ExtensionDeleteDialog from '@/components/dashboard/extensions/ExtensionDeleteDialog';

function ExtensionsManager() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { hasPermission, hasAnyPermission, isPlatformAdmin, isFullAccess } = usePermissions();
  const { currentTenant } = useTenant();
  const segments = useSplatSegments();

  const [extensions, setExtensions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingExtension, setEditingExtension] = useState(null);
  const [selectedForABAC, setSelectedForABAC] = useState(null);
  const [showGuide, setShowGuide] = useState(false);
  const [extensionToDelete, setExtensionToDelete] = useState(null);

  const tabValues = ['installed', 'install', 'marketplace', 'settings', 'health', 'logs', 'abac', 'rbac'];
  const hasTabSegment = tabValues.includes(segments[0]);
  const rawActiveTab = hasTabSegment ? segments[0] : 'installed';
  const activeTab = rawActiveTab === 'rbac' ? 'abac' : rawActiveTab;
  const activeChildSegment = hasTabSegment ? segments[1] || null : null;
  const extraSegments = hasTabSegment ? segments.slice(2) : segments.slice(1);
  const selectedAbacRouteId = activeTab === 'abac' && activeChildSegment && activeChildSegment !== 'selected' ? activeChildSegment : null;

  // ABAC and extension-permission access logic
  const isSuperAdmin = isPlatformAdmin || isFullAccess;
  const canCreate = isSuperAdmin || hasPermission('platform.extensions.create');
  const canManageGlobal = isSuperAdmin || hasPermission('platform.extensions.update');
  const canView = isSuperAdmin || hasAnyPermission(['platform.extensions.read', 'platform.extensions.update', 'platform.extensions.create']);

  const tabMeta = useMemo(() => ([
    { value: 'installed', label: t('extensions.installed'), count: extensions.length },
    ...(canCreate ? [{ value: 'install', label: t('extensions.install') }] : []),
    { value: 'marketplace', label: t('extensions.marketplace') },
    ...(canManageGlobal ? [
      { value: 'settings', label: t('extensions.settings') },
      { value: 'health', label: t('extensions.health') },
      { value: 'logs', label: t('extensions.logs') },
      { value: 'abac', label: t('extensions.abac'), icon: Shield },
    ] : []),
  ]), [canCreate, canManageGlobal, extensions.length, t]);

  useEffect(() => {
    if (segments.length === 0) {
      return;
    }

    if (!hasTabSegment) {
      navigate('/cmspanel/extensions', { replace: true });
      return;
    }

    if (rawActiveTab === 'rbac') {
      const shouldDropLegacySelected = activeChildSegment === 'selected';
      const suffix = activeChildSegment && !shouldDropLegacySelected ? `/${activeChildSegment}` : '';
      navigate(`/cmspanel/extensions/abac${suffix}`, { replace: true });
      return;
    }

    if (activeTab === 'installed' && segments.length > 1) {
      navigate('/cmspanel/extensions', { replace: true });
      return;
    }

    if (activeTab === 'install' && !canCreate) {
      navigate('/cmspanel/extensions', { replace: true });
      return;
    }

    if (['settings', 'health', 'logs', 'abac'].includes(activeTab) && !canManageGlobal) {
      navigate('/cmspanel/extensions', { replace: true });
      return;
    }

    if (activeTab === 'marketplace' && segments.length > 1) {
      navigate('/cmspanel/extensions/marketplace', { replace: true });
      return;
    }

    if (activeTab === 'health' && segments.length > 1) {
      navigate('/cmspanel/extensions/health', { replace: true });
      return;
    }

    if (activeTab === 'logs' && segments.length > 1) {
      navigate('/cmspanel/extensions/logs', { replace: true });
      return;
    }

    if (activeTab === 'abac' && selectedAbacRouteId && extraSegments.length > 0) {
      navigate(`/cmspanel/extensions/abac/${selectedAbacRouteId}`, { replace: true });
      return;
    }

    if (activeTab === 'abac' && activeChildSegment === 'selected') {
      navigate('/cmspanel/extensions/abac', { replace: true });
      return;
    }

    if (activeTab === 'abac' && !selectedAbacRouteId && extraSegments.length > 0) {
      navigate('/cmspanel/extensions/abac', { replace: true });
      return;
    }

    if (activeTab === 'settings') {
      if (activeChildSegment && activeChildSegment !== 'select') {
        navigate('/cmspanel/extensions/settings', { replace: true });
        return;
      }
      if (extraSegments.length > 0) {
        navigate('/cmspanel/extensions/settings', { replace: true });
      }
    }
  }, [segments, hasTabSegment, rawActiveTab, activeTab, activeChildSegment, selectedAbacRouteId, extraSegments, navigate, canCreate, canManageGlobal]);

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

  useEffect(() => {
    if (activeTab !== 'abac') {
      if (selectedForABAC) {
        setSelectedForABAC(null);
      }
      return;
    }

    if (!selectedAbacRouteId && selectedForABAC) {
      setSelectedForABAC(null);
      return;
    }

    if (!selectedAbacRouteId) {
      return;
    }

    const matched = extensions.find((extension) => extension.id === selectedAbacRouteId);
    if (matched) {
      if (!selectedForABAC || selectedForABAC.id !== matched.id) {
        setSelectedForABAC(matched);
      }
    }
  }, [activeTab, extensions, selectedAbacRouteId, selectedForABAC]);

  const navigateToTab = useCallback((tabValue) => {
    navigate(tabValue === 'installed' ? '/cmspanel/extensions' : `/cmspanel/extensions/${tabValue}`);
  }, [navigate]);

  const headerBadges = [
    { label: 'Refresh-safe `/cmspanel/extensions` routes', icon: Layers3, tone: 'text-primary' },
    { label: 'Platform permissions and signed settings routes', icon: ShieldCheck, tone: 'text-emerald-600' },
  ];

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
        <Button onClick={() => navigateToTab('install')} className="h-10 rounded-xl bg-primary px-4 text-primary-foreground shadow-sm hover:opacity-95">
          <Upload className="mr-2 h-4 w-4" />
          {t('extensions.install')}
        </Button>
      )}
    </div>
  );

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link to="/cmspanel" className="flex items-center gap-1 transition-colors hover:text-foreground">
            <Home className="h-4 w-4" />
            <span>{t('common.dashboard') || 'Dashboard'}</span>
          </Link>
          <ChevronRight className="h-4 w-4" />
          <span className="font-medium text-foreground">{t('extensions.title')}</span>
        </div>

        <div className="rounded-3xl border border-border/70 bg-gradient-to-br from-background via-background to-primary/5 p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-1.5">
              <div className="flex items-center gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-sm">
                  <Puzzle className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Platform Modules</p>
                  <p className="text-lg font-semibold text-foreground">{t('extensions.title')}</p>
                </div>
              </div>
              <p className="max-w-3xl text-sm text-muted-foreground">{t('extensions.subtitle')}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary" className="rounded-full border border-border/70 bg-background/80 px-3 py-1 text-xs font-medium shadow-sm">
                {currentTenant?.name ? `Tenant: ${currentTenant.name}` : 'Platform scope'}
              </Badge>
              <Badge variant="secondary" className="rounded-full border border-border/70 bg-background/80 px-3 py-1 text-xs font-medium shadow-sm">
                {extensions.length} installed entries
              </Badge>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-3 text-sm text-muted-foreground">
            {headerBadges.map((item) => (
              <span key={item.label} className="inline-flex items-center gap-2 rounded-full bg-background/70 px-3 py-1.5 shadow-sm">
                <item.icon className={cn('h-4 w-4', item.tone)} />
                {item.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {tabMeta.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.value;
            return (
              <Button
                key={tab.value}
                variant="outline"
                onClick={() => navigateToTab(tab.value)}
                className={cn(
                  'rounded-full border-border/70 bg-background/80 px-4 text-muted-foreground shadow-sm hover:bg-accent/70 hover:text-foreground',
                  isActive && 'border-primary/30 bg-primary/10 text-primary'
                )}
              >
                {Icon ? <Icon className="mr-2 h-4 w-4" /> : null}
                {tab.label}
                {typeof tab.count === 'number' ? <span className="ml-2 rounded-full bg-background/80 px-2 py-0.5 text-[11px] font-semibold text-foreground">{tab.count}</span> : null}
              </Button>
            );
          })}
        </div>

        {headerActions}
      </div>

      <ExtensionsOverviewCards
        extensionsCount={extensions.length}
        activeExtensionsCount={activeExtensionsCount}
        ownedExtensionsCount={ownedExtensionsCount}
        searchActive={searchActive}
        searchTerm={searchTerm}
      />

      {activeTab === 'installed' ? (
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
            onSelectAbac={async (extension) => {
              setSelectedForABAC(extension);
              const routeId = await encodeRouteParam({ value: extension.id, scope: 'extensions.abac' });
              if (!routeId) {
                navigate('/cmspanel/extensions/abac');
                return;
              }
              navigate(`/cmspanel/extensions/abac/${routeId}`);
            }}
            onRefresh={fetchExtensions}
          />
      ) : null}

      {canCreate && activeTab === 'install' ? (
        <ExtensionInstaller onInstallComplete={() => { navigate('/cmspanel/extensions'); fetchExtensions(); }} />
      ) : null}

      {activeTab === 'marketplace' ? (
        <ExtensionMarketplace onInstall={() => { navigate('/cmspanel/extensions'); fetchExtensions(); }} />
      ) : null}

      {canManageGlobal && activeTab === 'settings' ? <ExtensionSettings /> : null}
      {canManageGlobal && activeTab === 'health' ? <ExtensionHealthCheck /> : null}
      {canManageGlobal && activeTab === 'logs' ? <ExtensionLogs /> : null}
      {canManageGlobal && activeTab === 'abac' ? (
        <ExtensionsAbacTab
          t={t}
          selectedForABAC={selectedForABAC}
          onBack={() => {
            setSelectedForABAC(null);
            navigate('/cmspanel/extensions/abac');
          }}
        />
      ) : null}

      <ExtensionDeleteDialog
        t={t}
        extension={extensionToDelete}
        onOpenChange={(open) => !open && setExtensionToDelete(null)}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}

export default ExtensionsManager;
