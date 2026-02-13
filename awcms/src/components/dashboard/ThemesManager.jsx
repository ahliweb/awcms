
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useNavigate } from 'react-router-dom';
import { Palette, Plus, Edit, Check, Trash2, Power, Copy, Download, Upload, Search, MoreVertical, LayoutTemplate } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { usePermissions } from '@/contexts/PermissionContext';
import { shadcnHslToHex } from '@/lib/themeUtils';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';

const MiniThemePreview = ({ config, isActive }) => {
    const primary = shadcnHslToHex(config?.colors?.primary) || '#3b82f6';
    const bg = shadcnHslToHex(config?.colors?.background) || '#ffffff';
    const card = shadcnHslToHex(config?.colors?.card) || '#ffffff';
    const text = shadcnHslToHex(config?.colors?.foreground) || '#000000';
    const secondary = shadcnHslToHex(config?.colors?.secondary) || '#f1f5f9';

    return (
        <div className="w-full h-32 rounded-t-lg relative overflow-hidden border-b border-slate-100" style={{ backgroundColor: bg }}>
            <div className="h-6 w-full flex items-center px-3 gap-2 border-b border-black/5" style={{ backgroundColor: bg }}>
                <div className="w-12 h-2 rounded-full opacity-80" style={{ backgroundColor: primary }}></div>
                <div className="flex-1"></div>
                <div className="w-4 h-4 rounded-full opacity-50" style={{ backgroundColor: secondary }}></div>
            </div>

            <div className="p-3 flex gap-2 h-full">
                <div className="w-1/4 h-20 rounded opacity-50 hidden sm:block" style={{ backgroundColor: secondary }}></div>
                <div className="flex-1 flex flex-col gap-2">
                    <div className="w-3/4 h-3 rounded opacity-80" style={{ backgroundColor: text }}></div>
                    <div className="w-1/2 h-2 rounded opacity-40" style={{ backgroundColor: text }}></div>
                    <div className="mt-2 p-2 rounded border border-black/5 shadow-sm" style={{ backgroundColor: card }}>
                        <div className="w-8 h-8 rounded mb-1 opacity-90" style={{ backgroundColor: primary }}></div>
                        <div className="w-full h-1.5 rounded opacity-30 mb-1" style={{ backgroundColor: text }}></div>
                        <div className="w-2/3 h-1.5 rounded opacity-30" style={{ backgroundColor: text }}></div>
                    </div>
                </div>
            </div>

            {isActive && (
                <div className="absolute top-2 right-2 bg-green-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm flex items-center gap-1">
                    <Check className="w-3 h-3" /> ACTIVE
                </div>
            )}
        </div>
    );
};

const ThemesManager = () => {
    const navigate = useNavigate();
    const { toast } = useToast();
    const [themes, setThemes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [themeToDelete, setThemeToDelete] = useState(null);

    const { hasPermission, isPlatformAdmin } = usePermissions();

    const fetchThemes = useCallback(async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('themes')
            .select('*, tenant:tenants(name)')
            .is('deleted_at', null)
            .order('is_active', { ascending: false })
            .order('created_at', { ascending: false });

        if (error) {
            toast({ title: "Error", description: "Failed to load themes", variant: "destructive" });
        } else {
            setThemes(data || []);
        }
        setLoading(false);
    }, [toast]);

    useEffect(() => {
        fetchThemes();
    }, [fetchThemes]);

    const handleActivate = async (id) => {
        if (!hasPermission('tenant.setting.update')) {
            toast({ title: "Access Denied", description: "Permission required.", variant: "destructive" });
            return;
        }
        try {
            const { error } = await supabase
                .from('themes')
                .update({ is_active: true })
                .eq('id', id);

            if (error) throw error;
            toast({ title: "Theme Activated", description: "New theme is now live!" });
            fetchThemes();
        } catch (error) {
            toast({ title: "Error", description: error.message, variant: "destructive" });
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
            toast({ title: "Deleted", description: "Theme moved to trash." });
            setThemeToDelete(null);
            fetchThemes();
        } catch (error) {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    };

    const handleDuplicate = async (theme) => {
        // Let DB handle ID generation by not including 'id'
        const { id: _id, created_at: _created_at, updated_at: _updated_at, ...rest } = theme;
        const newTheme = {
            ...rest,
            is_active: false,
            name: `${theme.name} (Copy)`,
            slug: `${theme.slug}-copy-${Date.now()}`
        };

        const { error } = await supabase.from('themes').insert([newTheme]);
        if (error) {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        } else {
            toast({ title: "Success", description: "Theme duplicated." });
            fetchThemes();
        }
    };

    const handleExport = (theme) => {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(theme.config));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", `${theme.slug || 'theme'}.json`);
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
    };

    const handleImport = (event) => {
        const fileReader = new FileReader();
        const file = event.target.files[0];
        if (!file) return;

        fileReader.readAsText(file, "UTF-8");
        fileReader.onload = async (e) => {
            try {
                const importedConfig = JSON.parse(e.target.result);
                if (!importedConfig.colors) throw new Error("Invalid theme file: missing colors");

                const { error } = await supabase.from('themes').insert([{
                    name: `Imported Theme ${new Date().toLocaleDateString()}`,
                    slug: `imported-${Date.now()}`,
                    description: "Imported from JSON file",
                    is_active: false,
                    config: importedConfig
                }]);

                if (error) throw error;
                toast({ title: "Success", description: "Theme imported successfully." });
                fetchThemes();
            } catch (err) {
                toast({ title: "Import Failed", description: err.message, variant: "destructive" });
            }
        };
    };

    const handleCreate = async () => {
        // We explicitly generate an ID client-side as a fallback, 
        // although the DB default should now handle it.
        const fallbackId = crypto.randomUUID();

        const defaultTheme = {
            id: fallbackId,
            name: "New Theme",
            slug: "new-theme-" + Date.now(),
            description: "A fresh start.",
            is_active: false,
            config: {
                colors: {
                    background: "0 0% 100%",
                    foreground: "222.2 84% 4.9%",
                    primary: "221.2 83.2% 53.3%",
                    primaryForeground: "210 40% 98%",
                    border: "214.3 31.8% 91.4%",
                    card: "0 0% 100%",
                    cardForeground: "222.2 84% 4.9%",
                    secondary: "210 40% 96.1%",
                    secondaryForeground: "222.2 47.4% 11.2%",
                    muted: "210 40% 96.1%",
                    mutedForeground: "215.4 16.3% 46.9%",
                    accent: "210 40% 96.1%",
                    destructive: "0 84.2% 60.2%",
                    input: "214.3 31.8% 91.4%",
                    ring: "221.2 83.2% 53.3%"
                },
                fonts: { heading: 'Inter, sans-serif', body: 'Inter, sans-serif' },
                radius: 0.5
            }
        };

        const { data, error } = await supabase
            .from('themes')
            .insert([defaultTheme])
            .select()
            .single();

        if (error) {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        } else {
            // Navigate to the new theme (using the returned ID or our fallback)
            navigate(`/cmspanel/themes/${data?.id || fallbackId}`);
        }
    };

    const filteredThemes = themes.filter(t =>
        t.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <AdminPageLayout requiredPermission="tenant.setting.read">
            <PageHeader
                title="Theme Gallery"
                description="Manage, customize, and activate visual themes for your site."
                icon={Palette}
                breadcrumbs={[{ label: 'Themes', icon: Palette }]}
                actions={
                    <div className="flex gap-2 w-full sm:w-auto">
                        <div className="relative">
                            <input
                                type="file"
                                accept=".json"
                                className="absolute inset-0 opacity-0 cursor-pointer w-full"
                                onChange={handleImport}
                                disabled={!hasPermission('tenant.setting.update')}
                            />
                            <Button variant="outline" className="w-full sm:w-auto">
                                <Upload className="w-4 h-4 mr-2" /> Import
                            </Button>
                        </div>

                        {hasPermission('tenant.setting.update') && (
                            <Button onClick={handleCreate} className="w-full sm:w-auto">
                                <Plus className="w-4 h-4 mr-2" /> New Theme
                            </Button>
                        )}
                    </div>
                }
            />

            {/* Search Bar */}
            <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                    placeholder="Search themes..."
                    className="pl-9 bg-background"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                />
            </div>

            {/* Grid Layout */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {loading ? (
                    [...Array(4)].map((_, i) => (
                        <div key={i} className="h-64 bg-muted/50 rounded-xl animate-pulse"></div>
                    ))
                ) : filteredThemes.length === 0 ? (
                    <div className="col-span-full py-20 text-center text-muted-foreground bg-card rounded-xl border border-dashed border-border">
                        <LayoutTemplate className="w-12 h-12 mx-auto mb-4 opacity-20" />
                        <p>No themes found matching your search.</p>
                    </div>
                ) : (
                    filteredThemes.map(theme => (
                        <div key={theme.id} className={`group bg-card rounded-xl border transition-all duration-200 overflow-hidden flex flex-col ${theme.is_active ? 'border-primary shadow-md ring-1 ring-primary' : 'border-border hover:border-primary/50 hover:shadow-lg'}`}>

                            <MiniThemePreview config={theme.config} isActive={theme.is_active} />

                            <div className="p-4 flex-1 flex flex-col">
                                <div className="flex justify-between items-start mb-2">
                                    <div>
                                        <h3 className="font-semibold text-foreground truncate pr-2" title={theme.name}>{theme.name}</h3>
                                        {isPlatformAdmin && (
                                            <span className="text-xs font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                                                {theme.tenant?.name || '(Unknown Tenant)'}
                                            </span>
                                        )}
                                        <p className="text-xs text-muted-foreground line-clamp-2 min-h-[2.5em] mt-1">{theme.description || 'No description provided.'}</p>
                                    </div>

                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                                <MoreVertical className="w-4 h-4 text-muted-foreground" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem onClick={() => handleExport(theme)}>
                                                <Download className="w-4 h-4 mr-2" /> Export JSON
                                            </DropdownMenuItem>
                                            {hasPermission('tenant.setting.update') && (
                                                <DropdownMenuItem onClick={() => handleDuplicate(theme)}>
                                                    <Copy className="w-4 h-4 mr-2" /> Duplicate
                                                </DropdownMenuItem>
                                            )}
                                            <DropdownMenuSeparator />
                                            {hasPermission('tenant.setting.update') && (
                                                <DropdownMenuItem
                                                    onClick={() => setThemeToDelete(theme.id)}
                                                    className="text-destructive focus:text-destructive focus:bg-destructive/10"
                                                    disabled={theme.is_active}
                                                >
                                                    <Trash2 className="w-4 h-4 mr-2" /> Delete
                                                </DropdownMenuItem>
                                            )}
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </div>

                                <div className="mt-auto pt-4 flex gap-2">
                                    {hasPermission('tenant.setting.update') && (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="flex-1"
                                            onClick={() => navigate(`/cmspanel/themes/edit/${theme.id}`)}
                                        >
                                            <Edit className="w-3.5 h-3.5 mr-1.5" /> Customize
                                        </Button>
                                    )}

                                    {!theme.is_active && hasPermission('tenant.setting.update') && (
                                        <Button
                                            size="sm"
                                            className="flex-1"
                                            onClick={() => handleActivate(theme.id)}
                                        >
                                            <Power className="w-3.5 h-3.5 mr-1.5" /> Activate
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            <AlertDialog open={!!themeToDelete} onOpenChange={(open) => !open && setThemeToDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will move the theme to trash. You can restore it later if needed.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">Move to Trash</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </AdminPageLayout>
    );
};

export default ThemesManager;
