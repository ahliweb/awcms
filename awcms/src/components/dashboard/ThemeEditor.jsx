import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Loader2 } from 'lucide-react';
import { usePermissions } from '@/contexts/PermissionContext';
import { hexToShadcnHsl, applyTheme } from '@/lib/themeUtils';
import { encodeRouteParam } from '@/lib/routeSecurity';
import useSecureRouteParam from '@/hooks/useSecureRouteParam';
import useSplatSegments from '@/hooks/useSplatSegments';
import ThemeEditorTopBar from '@/components/dashboard/theme-editor/ThemeEditorTopBar';
import ThemeEditorSidebar from '@/components/dashboard/theme-editor/ThemeEditorSidebar';
import ThemeEditorPreview from '@/components/dashboard/theme-editor/ThemeEditorPreview';

const DEFAULT_LIGHT_COLORS = {
    background: "0 0% 100%",
    foreground: "222.2 84% 4.9%",
    card: "0 0% 100%",
    cardForeground: "222.2 84% 4.9%",
    popover: "0 0% 100%",
    popoverForeground: "222.2 84% 4.9%",
    primary: "222.2 47.4% 11.2%",
    primaryForeground: "210 40% 98%",
    secondary: "210 40% 96.1%",
    secondaryForeground: "222.2 47.4% 11.2%",
    muted: "210 40% 96.1%",
    mutedForeground: "215.4 16.3% 46.9%",
    accent: "210 40% 96.1%",
    accentForeground: "222.2 47.4% 11.2%",
    destructive: "0 84.2% 60.2%",
    destructiveForeground: "210 40% 98%",
    border: "214.3 31.8% 91.4%",
    input: "214.3 31.8% 91.4%",
    ring: "222.2 84% 4.9%",
};

const DEFAULT_DARK_COLORS = {
    background: "222.2 84% 4.9%",
    foreground: "210 40% 98%",
    card: "222.2 84% 4.9%",
    cardForeground: "210 40% 98%",
    popover: "222.2 84% 4.9%",
    popoverForeground: "210 40% 98%",
    primary: "210 40% 98%",
    primaryForeground: "222.2 47.4% 11.2%",
    secondary: "217.2 32.6% 17.5%",
    secondaryForeground: "210 40% 98%",
    muted: "217.2 32.6% 17.5%",
    mutedForeground: "215 20.2% 65.1%",
    accent: "217.2 32.6% 17.5%",
    accentForeground: "210 40% 98%",
    destructive: "0 62.8% 30.6%",
    destructiveForeground: "210 40% 98%",
    border: "217.2 32.6% 17.5%",
    input: "217.2 32.6% 17.5%",
    ring: "212.7 26.8% 83.9%",
};

const ThemeEditor = () => {
    const { id: routeParam } = useParams();
    const navigate = useNavigate();
    const { toast } = useToast();
    const { t } = useTranslation();
    const segments = useSplatSegments();
    const { value: themeId, loading: routeLoading, isLegacy } = useSecureRouteParam(routeParam, 'themes.edit');

    // Permission Check
    const { hasPermission } = usePermissions();
    const canEdit = hasPermission('tenant.theme.update');

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [resetDialogOpen, setResetDialogOpen] = useState(false);
    const allowedTabs = ['colors', 'typography', 'layout'];
    const hasTabSegment = segments.length > 0 && allowedTabs.includes(segments[0]);
    const activeTab = hasTabSegment ? segments[0] : 'colors';
    const baseEditPath = routeParam ? `/cmspanel/themes/edit/${routeParam}` : null;
    const [previewMode, setPreviewMode] = useState('desktop');
    const [colorMode, setColorMode] = useState('light'); // 'light' | 'dark'

    // Form State
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [config, setConfig] = useState({
        colors: {},
        darkColors: {},
        fonts: { heading: 'Inter, sans-serif', body: 'Inter, sans-serif' },
        radius: 0.5
    });

    const fetchTheme = React.useCallback(async () => {
        if (!themeId) return;
        setLoading(true);
        const { data, error } = await supabase
            .from('themes')
            .select('*')
            .eq('id', themeId)
            .is('deleted_at', null)
            .single();

        if (error) {
            toast({ title: t('theme_editor.toasts.error_title'), description: t('theme_editor.toasts.error_load'), variant: "destructive" });
            navigate('/cmspanel/themes');
        } else {
            setName(data.name);
            setDescription(data.description || '');

            // Merge with defaults to prevent crashes
            const loadedColors = data.config?.colors || {};

            // Legacy Migration: If darkColors doesn't exist, clone colors as a starting point 
            // so the user has a base to work from instead of empty values.
            const loadedDarkColors = data.config?.darkColors || { ...loadedColors };

            setConfig({
                colors: loadedColors,
                darkColors: loadedDarkColors,
                fonts: data.config?.fonts || { heading: 'Inter, sans-serif', body: 'Inter, sans-serif' },
                radius: data.config?.radius !== undefined ? data.config.radius : 0.5
            });
        }
        setLoading(false);
    }, [themeId, navigate, toast, t]);

    useEffect(() => {
        fetchTheme();
    }, [fetchTheme]);

    useEffect(() => {
        if (!routeParam || routeLoading) return;
        if (!themeId) {
            navigate('/cmspanel/themes');
            return;
        }
        if (!isLegacy) return;
        const redirectLegacy = async () => {
            const routeId = await encodeRouteParam({ value: themeId, scope: 'themes.edit' });
            if (!routeId || routeId === routeParam) return;
            navigate(`/cmspanel/themes/edit/${routeId}`, { replace: true });
        };
        redirectLegacy();
    }, [routeParam, routeLoading, themeId, isLegacy, navigate]);

    useEffect(() => {
        if (!baseEditPath) return;
        if (segments.length === 0) return;
        if (!hasTabSegment) {
            navigate(baseEditPath, { replace: true });
        }
    }, [baseEditPath, segments, hasTabSegment, navigate]);

    // When config changes, update live preview immediately
    useEffect(() => {
        if (!loading) {
            applyTheme(config);
        }
    }, [config, loading]);

    const handleColorChange = (key, hexValue) => {
        const hslValue = hexToShadcnHsl(hexValue);
        const targetGroup = colorMode === 'light' ? 'colors' : 'darkColors';

        setConfig(prev => ({
            ...prev,
            [targetGroup]: {
                ...prev[targetGroup],
                [key]: hslValue
            }
        }));
    };

    const handleFontChange = (type, value) => {
        setConfig(prev => ({
            ...prev,
            fonts: {
                ...prev.fonts,
                [type]: value
            }
        }));
    };

    const handleRadiusChange = (val) => {
        setConfig(prev => ({ ...prev, radius: val[0] }));
    };

    const handleReset = () => {
        const modeLabel = colorMode === 'light' ? 'Light' : 'Dark';
        setConfig(prev => ({
            ...prev,
            [colorMode === 'light' ? 'colors' : 'darkColors']:
                colorMode === 'light' ? DEFAULT_LIGHT_COLORS : DEFAULT_DARK_COLORS
        }));
        setResetDialogOpen(false);
        toast({ title: "Reset Successful", description: `${modeLabel} mode colors have been reset.` });
    };

    // ... existing handleSave ...
    const handleSave = async () => {
        if (!canEdit) {
            toast({ title: t('theme_editor.toasts.access_denied'), description: t('theme_editor.toasts.access_denied'), variant: "destructive" });
            return;
        }

        if (!themeId) {
            toast({ title: t('theme_editor.toasts.error_title'), description: t('theme_editor.toasts.error_load'), variant: "destructive" });
            return;
        }

        if (!name.trim()) {
            toast({ title: t('theme_editor.toasts.error_title'), description: t('theme_editor.toasts.validation_name'), variant: "destructive" });
            return;
        }

        setSaving(true);
        try {
            const { error } = await supabase
                .from('themes')
                .update({
                    name,
                    description,
                    config,
                    updated_at: new Date()
                })
                .eq('id', themeId);

            if (error) throw error;
            toast({ title: t('theme_editor.toasts.success_save'), description: t('theme_editor.toasts.success_save') });
        } catch (err) {
            toast({ title: t('theme_editor.toasts.error_save'), description: err.message, variant: "destructive" });
        } finally {
            setSaving(false);
        }
    };

    if (loading) return (
        <div className="flex h-screen items-center justify-center bg-background">
            <div className="rounded-2xl border border-border/60 bg-card/70 p-6 shadow-sm backdrop-blur-sm">
                <div className="flex items-center gap-3 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    <span>Loading theme editor...</span>
                </div>
            </div>
        </div>
    );

    return (
        <div className="flex h-screen flex-col overflow-hidden bg-background">
            <ThemeEditorTopBar
                navigate={navigate}
                t={t}
                name={name}
                previewMode={previewMode}
                setPreviewMode={setPreviewMode}
                handleSave={handleSave}
                saving={saving}
                canEdit={canEdit}
            />

            <div className="flex flex-1 overflow-hidden">
                <ThemeEditorSidebar
                    t={t}
                    activeTab={activeTab}
                    baseEditPath={baseEditPath}
                    navigate={navigate}
                    name={name}
                    setName={setName}
                    canEdit={canEdit}
                    colorMode={colorMode}
                    setColorMode={setColorMode}
                    config={config}
                    handleFontChange={handleFontChange}
                    handleRadiusChange={handleRadiusChange}
                    handleColorChange={handleColorChange}
                    resetDialogOpen={resetDialogOpen}
                    setResetDialogOpen={setResetDialogOpen}
                    handleReset={handleReset}
                />

                <ThemeEditorPreview
                    t={t}
                    previewMode={previewMode}
                    colorMode={colorMode}
                />
            </div>
        </div>
    );
};

export default ThemeEditor;
