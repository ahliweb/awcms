import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Palette } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { encodeRouteParam } from '@/lib/routeSecurity';
import { usePermissions } from '@/contexts/PermissionContext';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';
import ThemesHeaderActions from '@/components/dashboard/themes/ThemesHeaderActions';
import ThemesSearchBar from '@/components/dashboard/themes/ThemesSearchBar';
import ThemesGrid from '@/components/dashboard/themes/ThemesGrid';
import ThemeDeleteDialog from '@/components/dashboard/themes/ThemeDeleteDialog';

const ThemesManager = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { hasPermission, isPlatformAdmin } = usePermissions();

  const [themes, setThemes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [themeToDelete, setThemeToDelete] = useState(null);

  const canUpdate = hasPermission('tenant.setting.update');

  const fetchThemes = useCallback(async () => {
    setLoading(true);

    const { data, error } = await supabase
      .from('themes')
      .select('*, tenant:tenants(name)')
      .is('deleted_at', null)
      .order('is_active', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      toast({ title: 'Error', description: 'Failed to load themes', variant: 'destructive' });
    } else {
      setThemes(data || []);
    }

    setLoading(false);
  }, [toast]);

  useEffect(() => {
    fetchThemes();
  }, [fetchThemes]);

  const handleActivate = async (id) => {
    if (!canUpdate) {
      toast({ title: 'Access Denied', description: 'Permission required.', variant: 'destructive' });
      return;
    }

    try {
      const { error } = await supabase
        .from('themes')
        .update({ is_active: true })
        .eq('id', id);

      if (error) throw error;

      toast({ title: 'Theme Activated', description: 'New theme is now live!' });
      fetchThemes();
    } catch (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
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

      toast({ title: 'Deleted', description: 'Theme moved to trash.' });
      setThemeToDelete(null);
      fetchThemes();
    } catch (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
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
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: 'Theme duplicated.' });
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

        toast({ title: 'Success', description: 'Theme imported successfully.' });
        fetchThemes();
      } catch (error) {
        toast({ title: 'Import Failed', description: error.message, variant: 'destructive' });
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

  return (
    <AdminPageLayout requiredPermission="tenant.setting.read">
      <PageHeader
        title="Theme Gallery"
        description="Manage, customize, and activate visual themes for your site."
        icon={Palette}
        breadcrumbs={[{ label: 'Themes', icon: Palette }]}
        actions={(
          <ThemesHeaderActions
            canUpdate={canUpdate}
            onImport={handleImport}
            onCreate={handleCreate}
          />
        )}
      />

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
