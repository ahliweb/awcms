import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Save, Loader2, Monitor, Smartphone, Type, Palette as PaletteIcon, Layout } from 'lucide-react';
import { usePermissions } from '@/contexts/PermissionContext';
import { shadcnHslToHex, hexToShadcnHsl, applyTheme } from '@/lib/themeUtils';

// Standard Web Fonts & Google Fonts Options
const FONT_OPTIONS = [
    { label: 'Inter (Default)', value: 'Inter, sans-serif' },
    { label: 'Roboto', value: 'Roboto, sans-serif' },
    { label: 'Open Sans', value: '"Open Sans", sans-serif' },
    { label: 'Lato', value: 'Lato, sans-serif' },
    { label: 'Montserrat', value: 'Montserrat, sans-serif' },
    { label: 'Playfair Display (Serif)', value: '"Playfair Display", serif' },
    { label: 'Merriweather (Serif)', value: 'Merriweather, serif' },
    { label: 'Monospace', value: 'monospace' },
    { label: 'System UI', value: 'system-ui, -apple-system, sans-serif' },
];

const ThemeEditor = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const { toast } = useToast();
    const { t } = useTranslation();

    // Permission Check
    const { hasPermission } = usePermissions();
    const canEdit = hasPermission('tenant.setting.update');

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [activeTab, setActiveTab] = useState('colors');
    const [previewMode, setPreviewMode] = useState('desktop');

    // Form State
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [config, setConfig] = useState({
        colors: {},
        fonts: { heading: 'Inter, sans-serif', body: 'Inter, sans-serif' },
        radius: 0.5
    });

    const fetchTheme = React.useCallback(async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('themes')
            .select('*')
            .eq('id', id)
            .is('deleted_at', null)
            .single();

        if (error) {
            toast({ title: t('theme_editor.toasts.error_title'), description: t('theme_editor.toasts.error_load'), variant: "destructive" });
            navigate('/cmspanel/themes');
        } else {
            setName(data.name);
            setDescription(data.description || '');

            // Merge with defaults to prevent crashes
            setConfig({
                colors: data.config?.colors || {},
                fonts: data.config?.fonts || { heading: 'Inter, sans-serif', body: 'Inter, sans-serif' },
                radius: data.config?.radius !== undefined ? data.config.radius : 0.5
            });
        }
        setLoading(false);
    }, [id, navigate, toast, t]);

    useEffect(() => {
        fetchTheme();
    }, [fetchTheme]);

    // When config changes, update live preview immediately
    useEffect(() => {
        if (!loading) {
            applyTheme(config);
        }
    }, [config, loading]);

    const handleColorChange = (key, hexValue) => {
        const hslValue = hexToShadcnHsl(hexValue);
        setConfig(prev => ({
            ...prev,
            colors: {
                ...prev.colors,
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

    const handleSave = async () => {
        if (!canEdit) {
            toast({ title: t('theme_editor.toasts.access_denied'), description: t('theme_editor.toasts.access_denied'), variant: "destructive" });
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
                .eq('id', id);

            if (error) throw error;
            toast({ title: t('theme_editor.toasts.success_save'), description: t('theme_editor.toasts.success_save') });
        } catch (err) {
            toast({ title: t('theme_editor.toasts.error_save'), description: err.message, variant: "destructive" });
        } finally {
            setSaving(false);
        }
    };

    if (loading) return (
        <div className="flex items-center justify-center h-screen">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
    );

    const ColorRow = ({ label, configKey, description }) => (
        <div className="flex items-center justify-between py-3 border-b border-border last:border-0">
            <div className="flex flex-col gap-0.5">
                <Label className="text-sm font-medium text-foreground">{label}</Label>
                {description && <span className="text-xs text-muted-foreground">{description}</span>}
            </div>
            <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground font-mono bg-muted px-2 py-1 rounded border border-border uppercase">
                    {shadcnHslToHex(config.colors?.[configKey])}
                </span>
                <div className="relative w-9 h-9 rounded-md overflow-hidden border border-border shadow-sm cursor-pointer transition-transform hover:scale-105 active:scale-95 ring-offset-2 focus-within:ring-2 focus-within:ring-primary">
                    <input
                        type="color"
                        className="absolute inset-0 w-[150%] h-[150%] -top-[25%] -left-[25%] cursor-pointer p-0 border-0 opacity-0"
                        value={shadcnHslToHex(config.colors?.[configKey])}
                        onChange={(e) => handleColorChange(configKey, e.target.value)}
                        disabled={!canEdit}
                    />
                    <div
                        className="w-full h-full pointer-events-none"
                        style={{ backgroundColor: shadcnHslToHex(config.colors?.[configKey]) }}
                    />
                </div>
            </div>
        </div>
    );

    return (
        <div className="flex flex-col h-screen bg-muted/30 overflow-hidden">
            {/* Top Bar */}
            <div className="flex justify-between items-center px-6 py-3 bg-card border-b border-border shrink-0 shadow-sm z-10">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => navigate('/cmspanel/themes')} className="hover:bg-muted">
                        <ArrowLeft className="w-5 h-5 text-muted-foreground" />
                    </Button>
                    <div className="flex flex-col">
                        <h1 className="text-lg font-bold text-foreground leading-tight">{t('theme_editor.title')}</h1>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="font-medium text-primary">{name}</span>
                            <span>•</span>
                            <span>{t('theme_editor.editing_mode')}</span>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <div className="bg-muted/50 rounded-lg p-1 hidden md:flex">
                        <Button
                            variant="ghost"
                            size="sm"
                            className={`h-7 px-3 ${previewMode === 'desktop' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}
                            onClick={() => setPreviewMode('desktop')}
                        >
                            <Monitor className="w-3.5 h-3.5 mr-1.5" /> {t('theme_editor.desktop_view')}
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            className={`h-7 px-3 ${previewMode === 'mobile' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}
                            onClick={() => setPreviewMode('mobile')}
                        >
                            <Smartphone className="w-3.5 h-3.5 mr-1.5" /> {t('theme_editor.mobile_view')}
                        </Button>
                    </div>
                    <div className="h-6 w-px bg-border mx-1"></div>
                    <Button onClick={handleSave} disabled={saving || !canEdit} className="min-w-[140px]">
                        {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                        {saving ? t('theme_editor.saving') : t('theme_editor.save_changes')}
                    </Button>
                </div>
            </div>

            <div className="flex flex-1 overflow-hidden">
                {/* Settings Sidebar */}
                <div className="w-[380px] bg-card border-r border-border flex flex-col overflow-hidden shrink-0">
                    <div className="p-4 border-b border-border">
                        <div className="space-y-3 mb-4">
                            <div className="space-y-1">
                                <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">{t('theme_editor.info_label')}</Label>
                                <Input value={name} onChange={e => setName(e.target.value)} placeholder={t('theme_editor.theme_name_placeholder')} disabled={!canEdit} />
                            </div>
                        </div>

                        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                            <TabsList className="w-full grid grid-cols-3">
                                <TabsTrigger value="colors" className="text-xs">
                                    <PaletteIcon className="w-3.5 h-3.5 mr-1.5" /> {t('theme_editor.tabs.colors')}
                                </TabsTrigger>
                                <TabsTrigger value="typography" className="text-xs">
                                    <Type className="w-3.5 h-3.5 mr-1.5" /> {t('theme_editor.tabs.typography')}
                                </TabsTrigger>
                                <TabsTrigger value="layout" className="text-xs">
                                    <Layout className="w-3.5 h-3.5 mr-1.5" /> {t('theme_editor.tabs.layout')}
                                </TabsTrigger>
                            </TabsList>
                        </Tabs>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                        <Tabs value={activeTab} className="w-full">
                            <TabsContent value="colors" className="mt-0 space-y-6">
                                <div>
                                    <h3 className="text-xs font-bold text-foreground uppercase tracking-wider mb-2">{t('theme_editor.colors.base_title')}</h3>
                                    <div className="bg-card rounded-lg border border-border shadow-sm p-1 px-3">
                                        <ColorRow label={t('theme_editor.colors.background')} configKey="background" description={t('theme_editor.colors.background_desc')} />
                                        <ColorRow label={t('theme_editor.colors.foreground')} configKey="foreground" description={t('theme_editor.colors.foreground_desc')} />
                                    </div>
                                </div>

                                <div>
                                    <h3 className="text-xs font-bold text-foreground uppercase tracking-wider mb-2">{t('theme_editor.colors.brand_title')}</h3>
                                    <div className="bg-card rounded-lg border border-border shadow-sm p-1 px-3">
                                        <ColorRow label={t('theme_editor.colors.primary')} configKey="primary" description={t('theme_editor.colors.primary_desc')} />
                                        <ColorRow label={t('theme_editor.colors.primary_text')} configKey="primaryForeground" description={t('theme_editor.colors.primary_text_desc')} />
                                        <ColorRow label={t('theme_editor.colors.secondary')} configKey="secondary" description={t('theme_editor.colors.secondary_desc')} />
                                        <ColorRow label={t('theme_editor.colors.secondary_text')} configKey="secondaryForeground" description={t('theme_editor.colors.secondary_text_desc')} />
                                        <ColorRow label={t('theme_editor.colors.accent')} configKey="accent" description={t('theme_editor.colors.accent_desc')} />
                                    </div>
                                </div>

                                <div>
                                    <h3 className="text-xs font-bold text-foreground uppercase tracking-wider mb-2">{t('theme_editor.colors.ui_title')}</h3>
                                    <div className="bg-card rounded-lg border border-border shadow-sm p-1 px-3">
                                        <ColorRow label={t('theme_editor.colors.border')} configKey="border" description={t('theme_editor.colors.border_desc')} />
                                        <ColorRow label={t('theme_editor.colors.input')} configKey="input" description={t('theme_editor.colors.input_desc')} />
                                        <ColorRow label={t('theme_editor.colors.card')} configKey="card" description={t('theme_editor.colors.card_desc')} />
                                        <ColorRow label={t('theme_editor.colors.destructive')} configKey="destructive" description={t('theme_editor.colors.destructive_desc')} />
                                    </div>
                                </div>
                            </TabsContent>

                            <TabsContent value="typography" className="mt-0 space-y-6">
                                <div>
                                    <h3 className="text-xs font-bold text-foreground uppercase tracking-wider mb-4">{t('theme_editor.typography.font_families')}</h3>
                                    <div className="space-y-4">
                                        <div className="space-y-2">
                                            <Label>{t('theme_editor.typography.headings_font')}</Label>
                                            <Select value={config.fonts?.heading} onValueChange={(val) => handleFontChange('heading', val)}>
                                                <SelectTrigger disabled={!canEdit}>
                                                    <SelectValue placeholder={t('theme_editor.typography.select_placeholder')} />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {FONT_OPTIONS.map(f => (
                                                        <SelectItem key={f.value} value={f.value} style={{ fontFamily: f.value }}>
                                                            {f.label}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <p className="text-xs text-muted-foreground">{t('theme_editor.typography.headings_desc')}</p>
                                        </div>

                                        <div className="space-y-2">
                                            <Label>{t('theme_editor.typography.body_font')}</Label>
                                            <Select value={config.fonts?.body} onValueChange={(val) => handleFontChange('body', val)}>
                                                <SelectTrigger disabled={!canEdit}>
                                                    <SelectValue placeholder={t('theme_editor.typography.select_placeholder')} />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {FONT_OPTIONS.map(f => (
                                                        <SelectItem key={f.value} value={f.value} style={{ fontFamily: f.value }}>
                                                            {f.label}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <p className="text-xs text-muted-foreground">{t('theme_editor.typography.body_desc')}</p>
                                        </div>
                                    </div>
                                </div>
                            </TabsContent>

                            <TabsContent value="layout" className="mt-0 space-y-6">
                                <div>
                                    <h3 className="text-xs font-bold text-foreground uppercase tracking-wider mb-4">{t('theme_editor.layout.border_radius')}</h3>
                                    <div className="bg-card p-4 rounded-lg border border-border">
                                        <div className="flex justify-between mb-4 items-center">
                                            <Label>{t('theme_editor.layout.corner_roundness')}</Label>
                                            <span className="text-xs font-mono bg-muted px-2 py-1 rounded text-muted-foreground">{config.radius}rem</span>
                                        </div>
                                        <Slider
                                            value={[parseFloat(config.radius || 0.5)]}
                                            max={2}
                                            step={0.1}
                                            onValueChange={handleRadiusChange}
                                            disabled={!canEdit}
                                        />
                                        <div className="flex justify-between mt-2 text-[10px] text-muted-foreground">
                                            <span>{t('theme_editor.layout.square')}</span>
                                            <span>{t('theme_editor.layout.round')}</span>
                                        </div>
                                    </div>
                                </div>
                            </TabsContent>
                        </Tabs>
                    </div>
                </div>

                {/* Live Preview Area */}
                <div className="flex-1 bg-slate-100/50 flex flex-col items-center justify-center p-8 overflow-hidden relative">
                    <div className="absolute inset-0 pattern-grid opacity-[0.03] pointer-events-none"></div>

                    <div
                        className={`transition-all duration-300 ease-in-out bg-background text-foreground shadow-2xl overflow-y-auto rounded-xl border border-border ${previewMode === 'mobile' ? 'w-[375px] h-[667px]' : 'w-full h-full max-w-5xl'
                            }`}
                    >
                        {/* Mock Website Structure */}
                        <div className="flex flex-col min-h-full font-sans">
                            {/* Header */}
                            <header className="border-b border-border sticky top-0 bg-background/95 backdrop-blur z-10">
                                <div className="container mx-auto px-6 h-16 flex items-center justify-between">
                                    <div className="font-bold text-xl text-primary font-heading">{t('theme_editor.preview.brand')}</div>
                                    <nav className="hidden md:flex gap-6 text-sm font-medium text-muted-foreground">
                                        <button className="text-foreground hover:text-primary transition-colors cursor-default">{t('theme_editor.preview.nav.home')}</button>
                                        <button className="hover:text-primary transition-colors cursor-default">{t('theme_editor.preview.nav.products')}</button>
                                        <button className="hover:text-primary transition-colors cursor-default">{t('theme_editor.preview.nav.about')}</button>
                                    </nav>
                                    <div className="flex gap-2">
                                        <Button size="sm" variant="outline">{t('theme_editor.preview.nav.login')}</Button>
                                        <Button size="sm">{t('theme_editor.preview.nav.get_started')}</Button>
                                    </div>
                                </div>
                            </header>


                            {/* Hero Section */}
                            <section className="py-20 px-6 text-center bg-secondary/30">
                                <div className="max-w-3xl mx-auto space-y-6">
                                    <h1 className="text-4xl md:text-6xl font-bold font-heading tracking-tight text-foreground">
                                        {t('theme_editor.preview.hero.title_start')} <span className="text-primary">{t('theme_editor.preview.hero.title_end')}</span>
                                    </h1>
                                    <p className="text-lg md:text-xl text-muted-foreground font-sans">
                                        {t('theme_editor.preview.hero.subtitle')}
                                    </p>
                                    <div className="flex justify-center gap-4 pt-4">
                                        <Button size="lg" className="rounded-full">{t('theme_editor.preview.hero.start_building')}</Button>
                                        <Button size="lg" variant="outline" className="rounded-full">{t('theme_editor.preview.hero.learn_more')}</Button>
                                    </div>
                                </div>
                            </section>

                            {/* Content Cards */}
                            <section className="py-16 px-6 bg-background">
                                <div className="max-w-5xl mx-auto">
                                    <h2 className="text-2xl font-bold font-heading mb-8 text-center">{t('theme_editor.preview.features.title')}</h2>
                                    <div className="grid md:grid-cols-3 gap-6">
                                        {[1, 2, 3].map((i) => (
                                            <div key={i} className="rounded-xl border border-border bg-card text-card-foreground p-6 shadow-sm hover:shadow-md transition-shadow">
                                                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4 text-primary">
                                                    <PaletteIcon className="w-6 h-6" />
                                                </div>
                                                <h3 className="font-semibold text-lg mb-2 font-heading">{t('theme_editor.preview.features.card_title', { number: i })}</h3>
                                                <p className="text-muted-foreground text-sm leading-relaxed">
                                                    {t('theme_editor.preview.features.card_desc')}
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </section>

                            <section className="py-16 px-6 bg-secondary/10">
                                <div className="max-w-md mx-auto bg-card rounded-xl shadow-sm p-8 border border-border">
                                    <h3 className="text-xl font-bold mb-6 font-heading">{t('theme_editor.preview.contact.title')}</h3>
                                    <div className="space-y-4">
                                        <div className="space-y-2">
                                            <Label>{t('theme_editor.preview.contact.email_label')}</Label>
                                            <Input placeholder={t('theme_editor.preview.contact.email_placeholder')} />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>{t('theme_editor.preview.contact.message_label')}</Label>
                                            <Textarea placeholder={t('theme_editor.preview.contact.message_placeholder')} className="h-24" />
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <div className="h-4 w-4 rounded border border-primary bg-primary text-primary-foreground flex items-center justify-center">
                                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                            </div>
                                            <Label className="font-normal text-muted-foreground">{t('theme_editor.preview.contact.newsletter')}</Label>
                                        </div>
                                        <Button className="w-full">{t('theme_editor.preview.contact.send_btn')}</Button>
                                    </div>
                                </div>
                            </section>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ThemeEditor;
