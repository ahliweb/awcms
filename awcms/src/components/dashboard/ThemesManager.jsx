import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Palette } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { useTranslation } from 'react-i18next';
import { encodeRouteParam } from '@/lib/routeSecurity';
import { usePermissions } from '@/contexts/PermissionContext';
import { AdminPageLayout, PageHeader } from '@/templates/emdash-admin';
import ThemesHeaderActions from '@/components/dashboard/themes/ThemesHeaderActions';
import ThemesSearchBar from '@/components/dashboard/themes/ThemesSearchBar';
import ThemesGrid from '@/components/dashboard/themes/ThemesGrid';
import ThemeDeleteDialog from '@/components/dashboard/themes/ThemeDeleteDialog';

const ThemesManager = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { hasPermission, isPlatformAdmin } = usePermissions();

  const [themes, setThemes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [themeToDelete, setThemeToDelete] = useState(null);

  const canUpdate = hasPermission('tenant.theme.update');

  const fetchThemes = useCallback(async () => {
    setLoading(true);

    const { data, error } = await supabase
      .from('themes')
      .select('*, tenant:tenants(name)')
      .is('deleted_at', null)
      .order('is_active', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      toast({ title: t('common.error'), description: t('themes.toast.load_error'), variant: 'destructive' });
    } else {
      setThemes(data || []);
    }

    setLoading(false);
  }, [toast, t]);

  useEffect(() => {
    fetchThemes();
  }, [fetchThemes]);

  const handleActivate = async (id) => {
    if (!canUpdate) {
      toast({ title: t('common.access_denied'), description: t('themes.toast.access_denied'), variant: 'destructive' });
      return;
    }

    try {
      const { error } = await supabase
        .from('themes')
        .update({ is_active: true })
        .eq('id', id);

      if (error) throw error;

      toast({ title: t('themes.toast.activated_title'), description: t('themes.toast.activated') });
      fetchThemes();
    } catch (error) {
      toast({ title: t('common.error'), description: error.message, variant: 'destructive' });
    }
  };

  const handleDelete = async () => {
    if (!themeToDelete) return;

    try {
      const { error } = await supabase
        .from('themes')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', themeToDelete);

      if (error) throw error;

      toast({ title: t('common.deleted'), description: t('themes.toast.deleted') });
      setThemeToDelete(null);
      fetchThemes();
    } catch (error) {
      toast({ title: t('common.error'), description: error.message, variant: 'destructive' });
    }
  };

  const handleDuplicate = async (theme) => {
    const { id: _id, created_at: _createdAt, updated_at: _updatedAt, ...rest } = theme;
    const newTheme = {
      ...rest,
      is_active: false,
      name: `${theme.name} (Copy)`,
      slug: `${theme.slug}-copy-${Date.now()}`,
    };

    const { error } = await supabase.from('themes').insert([newTheme]);
    if (error) {
      toast({ title: t('common.error'), description: error.message, variant: 'destructive' });
    } else {
      toast({ title: t('common.success'), description: t('themes.toast.duplicated') });
      fetchThemes();
    }
  };

  const handleExport = (theme) => {
    const dataStr = `data:text/json;charset=utf-8,${encodeURIComponent(JSON.stringify(theme.config))}`;
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute('href', dataStr);
    downloadAnchorNode.setAttribute('download', `${theme.slug || 'theme'}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const handleImport = (event) => {
    const fileReader = new FileReader();
    const file = event.target.files?.[0];
    if (!file) return;

    fileReader.readAsText(file, 'UTF-8');
    fileReader.onload = async (loadEvent) => {
      try {
        const importedConfig = JSON.parse(loadEvent.target.result);
        if (!importedConfig.colors) throw new Error('Invalid theme file: missing colors');

        const { error } = await supabase.from('themes').insert([
          {
            name: `Imported Theme ${new Date().toLocaleDateString()}`,
            slug: `imported-${Date.now()}`,
            description: 'Imported from JSON file',
            is_active: false,
            config: importedConfig,
          },
        ]);

        if (error) throw error;

        toast({ title: t('common.success'), description: t('themes.toast.imported') });
        fetchThemes();
      } catch (error) {
        toast({ title: t('themes.toast.import_failed'), description: error.message, variant: 'destructive' });
      }
    };
  };

  const handleCreate = async () => {
    const fallbackId = crypto.randomUUID();

    const defaultTheme = {
      id: fallbackId,
      name: 'New Theme',
      slug: `new-theme-${Date.now()}`,
      description: 'A fresh start.',
      is_active: false,
      config: {
        colors: {
          background: '0 0% 100%',
          foreground: '222.2 84% 4.9%',
          primary: '221.2 83.2% 53.3%',
          primaryForeground: '210 40% 98%',
          border: '214.3 31.8% 91.4%',
          card: '0 0% 100%',
          cardForeground: '222.2 84% 4.9%',
          secondary: '210 40% 96.1%',
          secondaryForeground: '222.2 47.4% 11.2%',
          muted: '210 40% 96.1%',
          mutedForeground: '215.4 16.3% 46.9%',
          accent: '210 40% 96.1%',
          destructive: '0 84.2% 60.2%',
          input: '214.3 31.8% 91.4%',
          ring: '221.2 83.2% 53.3%',
        },
        fonts: { heading: 'Inter, sans-serif', body: 'Inter, sans-serif' },
        radius: 0.5,
      },
    };

    const { data, error } = await supabase
      .from('themes')
      .insert([defaultTheme])
      .select()
      .single();

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return;
    }

    const targetId = data?.id || fallbackId;
    const routeId = await encodeRouteParam({ value: targetId, scope: 'themes.edit' });
    if (!routeId) return;
    navigate(`/cmspanel/themes/edit/${routeId}`);
  };

  const handleEdit = async (themeId) => {
    const routeId = await encodeRouteParam({ value: themeId, scope: 'themes.edit' });
    if (!routeId) return;
    navigate(`/cmspanel/themes/edit/${routeId}`);
  };

  const filteredThemes = themes.filter((theme) =>
    (theme.name || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const activeThemes = themes.filter((theme) => theme.is_active).length;
  const tenantThemes = themes.filter((theme) => theme.tenant?.name).length;

  return (
    <AdminPageLayout requiredPermission="tenant.theme.read">
      <PageHeader
        title={t('themes.manager.title')}
        description={t('themes.manager.description')}
        icon={Palette}
        breadcrumbs={[{ label: t('themes.manager.breadcrumb'), icon: Palette }]}
        actions={(
          <ThemesHeaderActions
            canUpdate={canUpdate}
            onImport={handleImport}
            onCreate={handleCreate}
          />
        )}
      />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-border/60 bg-card/70 p-4 shadow-sm backdrop-blur-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Themes</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{themes.length}</p>
          <p className="text-xs text-muted-foreground">Available theme records in scope</p>
        </div>
        <div className="rounded-2xl border border-border/60 bg-card/70 p-4 shadow-sm backdrop-blur-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Active</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{activeThemes}</p>
          <p className="text-xs text-muted-foreground">Currently enabled theme variants</p>
        </div>
        <div className="rounded-2xl border border-border/60 bg-card/70 p-4 shadow-sm backdrop-blur-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Tenant-bound</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{tenantThemes}</p>
          <p className="text-xs text-muted-foreground">Themes associated with a tenant record</p>
        </div>
        <div className="rounded-2xl border border-border/60 bg-card/70 p-4 shadow-sm backdrop-blur-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Privileges</p>
          <p className="mt-1 text-sm font-semibold text-foreground">{isPlatformAdmin ? 'Platform theme governance' : 'Tenant theme governance'}</p>
          <p className="text-xs text-muted-foreground">Activation and mutation remain permission-gated</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/70 shadow-sm backdrop-blur-sm">
        <div className="border-b border-border/70 bg-gradient-to-r from-primary/12 via-background/40 to-violet-500/12 p-4 sm:p-5">
          <h3 className="text-base font-semibold text-foreground">Theme workspace</h3>
          <p className="mt-1 text-sm text-muted-foreground">Search, duplicate, activate, export, or delete theme packs while preserving current permission boundaries.</p>
        </div>
        <div className="space-y-6 p-4 sm:p-5">
          <ThemesSearchBar searchTerm={searchTerm} setSearchTerm={setSearchTerm} />

          <ThemesGrid
            loading={loading}
            filteredThemes={filteredThemes}
            isPlatformAdmin={isPlatformAdmin}
            canUpdate={canUpdate}
            onEdit={handleEdit}
            onActivate={handleActivate}
            onExport={handleExport}
            onDuplicate={handleDuplicate}
            onDeleteRequest={setThemeToDelete}
          />
        </div>
      </div>

      <ThemeDeleteDialog
        open={!!themeToDelete}
        onOpenChange={(open) => {
          if (!open) setThemeToDelete(null);
        }}
        onConfirm={handleDelete}
      />
    </AdminPageLayout>
  );
};

export default ThemesManager;
