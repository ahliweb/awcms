
import React, { useEffect, useState } from 'react';
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
            toast({ title: "Error", description: "Failed to load theme", variant: "destructive" });
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
    }, [id, navigate, toast]);

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
            toast({ title: "Access Denied", description: "You do not have permission to save changes.", variant: "destructive" });
            return;
        }

        if (!name.trim()) {
            toast({ title: "Validation Error", description: "Theme name is required", variant: "destructive" });
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
            toast({ title: "Success", description: "Theme configuration saved." });
        } catch (err) {
            toast({ title: "Error", description: err.message, variant: "destructive" });
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
                        <h1 className="text-lg font-bold text-foreground leading-tight">Theme Editor</h1>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="font-medium text-primary">{name}</span>
                            <span>•</span>
                            <span>Editing Mode</span>
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
                            <Monitor className="w-3.5 h-3.5 mr-1.5" /> Desktop
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            className={`h-7 px-3 ${previewMode === 'mobile' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}
                            onClick={() => setPreviewMode('mobile')}
                        >
                            <Smartphone className="w-3.5 h-3.5 mr-1.5" /> Mobile
                        </Button>
                    </div>
                    <div className="h-6 w-px bg-border mx-1"></div>
                    <Button onClick={handleSave} disabled={saving || !canEdit} className="min-w-[140px]">
                        {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                        Save Changes
                    </Button>
                </div>
            </div>

            <div className="flex flex-1 overflow-hidden">
                {/* Settings Sidebar */}
                <div className="w-[380px] bg-card border-r border-border flex flex-col overflow-hidden shrink-0">
                    <div className="p-4 border-b border-border">
                        <div className="space-y-3 mb-4">
                            <div className="space-y-1">
                                <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Info</Label>
                                <Input value={name} onChange={e => setName(e.target.value)} placeholder="Theme Name" disabled={!canEdit} />
                            </div>
                        </div>

                        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                            <TabsList className="w-full grid grid-cols-3">
                                <TabsTrigger value="colors" className="text-xs">
                                    <PaletteIcon className="w-3.5 h-3.5 mr-1.5" /> Colors
                                </TabsTrigger>
                                <TabsTrigger value="typography" className="text-xs">
                                    <Type className="w-3.5 h-3.5 mr-1.5" /> Type
                                </TabsTrigger>
                                <TabsTrigger value="layout" className="text-xs">
                                    <Layout className="w-3.5 h-3.5 mr-1.5" /> Shape
                                </TabsTrigger>
                            </TabsList>
                        </Tabs>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                        <Tabs value={activeTab} className="w-full">
                            <TabsContent value="colors" className="mt-0 space-y-6">
                                <div>
                                    <h3 className="text-xs font-bold text-foreground uppercase tracking-wider mb-2">Base Colors</h3>
                                    <div className="bg-card rounded-lg border border-border shadow-sm p-1 px-3">
                                        <ColorRow label="Background" configKey="background" description="Page background color" />
                                        <ColorRow label="Foreground" configKey="foreground" description="Main text color" />
                                    </div>
                                </div>

                                <div>
                                    <h3 className="text-xs font-bold text-foreground uppercase tracking-wider mb-2">Brand Identity</h3>
                                    <div className="bg-card rounded-lg border border-border shadow-sm p-1 px-3">
                                        <ColorRow label="Primary" configKey="primary" description="Main brand color" />
                                        <ColorRow label="Primary Text" configKey="primaryForeground" description="Text on primary color" />
                                        <ColorRow label="Secondary" configKey="secondary" description="Accent/muted elements" />
                                        <ColorRow label="Secondary Text" configKey="secondaryForeground" description="Text on secondary color" />
                                        <ColorRow label="Accent" configKey="accent" description="Interactive highlights" />
                                    </div>
                                </div>

                                <div>
                                    <h3 className="text-xs font-bold text-foreground uppercase tracking-wider mb-2">UI Elements</h3>
                                    <div className="bg-card rounded-lg border border-border shadow-sm p-1 px-3">
                                        <ColorRow label="Border" configKey="border" description="Borders and dividers" />
                                        <ColorRow label="Input" configKey="input" description="Form inputs" />
                                        <ColorRow label="Card" configKey="card" description="Card backgrounds" />
                                        <ColorRow label="Destructive" configKey="destructive" description="Error states" />
                                    </div>
                                </div>
                            </TabsContent>

                            <TabsContent value="typography" className="mt-0 space-y-6">
                                <div>
                                    <h3 className="text-xs font-bold text-foreground uppercase tracking-wider mb-4">Font Families</h3>
                                    <div className="space-y-4">
                                        <div className="space-y-2">
                                            <Label>Headings Font</Label>
                                            <Select value={config.fonts?.heading} onValueChange={(val) => handleFontChange('heading', val)}>
                                                <SelectTrigger disabled={!canEdit}>
                                                    <SelectValue placeholder="Select font" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {FONT_OPTIONS.map(f => (
                                                        <SelectItem key={f.value} value={f.value} style={{ fontFamily: f.value }}>
                                                            {f.label}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <p className="text-xs text-muted-foreground">Used for h1, h2, h3, etc.</p>
                                        </div>

                                        <div className="space-y-2">
                                            <Label>Body Font</Label>
                                            <Select value={config.fonts?.body} onValueChange={(val) => handleFontChange('body', val)}>
                                                <SelectTrigger disabled={!canEdit}>
                                                    <SelectValue placeholder="Select font" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {FONT_OPTIONS.map(f => (
                                                        <SelectItem key={f.value} value={f.value} style={{ fontFamily: f.value }}>
                                                            {f.label}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <p className="text-xs text-muted-foreground">Used for paragraphs and UI text.</p>
                                        </div>
                                    </div>
                                </div>
                            </TabsContent>

                            <TabsContent value="layout" className="mt-0 space-y-6">
                                <div>
                                    <h3 className="text-xs font-bold text-foreground uppercase tracking-wider mb-4">Border Radius</h3>
                                    <div className="bg-card p-4 rounded-lg border border-border">
                                        <div className="flex justify-between mb-4 items-center">
                                            <Label>Corner Roundness</Label>
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
                                            <span>Square</span>
                                            <span>Round</span>
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
                                    <div className="font-bold text-xl text-primary font-heading">Brand</div>
                                    <nav className="hidden md:flex gap-6 text-sm font-medium text-muted-foreground">
                                        <button className="text-foreground hover:text-primary transition-colors cursor-default">Home</button>
                                        <button className="hover:text-primary transition-colors cursor-default">Products</button>
                                        <button className="hover:text-primary transition-colors cursor-default">About</button>
                                    </nav>
                                    <div className="flex gap-2">
                                        <Button size="sm" variant="outline">Log in</Button>
                                        <Button size="sm">Get Started</Button>
                                    </div>
                                </div>
                            </header>


                            {/* Hero Section */}
                            <section className="py-20 px-6 text-center bg-secondary/30">
                                <div className="max-w-3xl mx-auto space-y-6">
                                    <h1 className="text-4xl md:text-6xl font-bold font-heading tracking-tight text-foreground">
                                        Your Vision, <span className="text-primary">Realized.</span>
                                    </h1>
                                    <p className="text-lg md:text-xl text-muted-foreground font-sans">
                                        This is a preview of how your typography and colors work together. Make adjustments in the editor to see instant changes.
                                    </p>
                                    <div className="flex justify-center gap-4 pt-4">
                                        <Button size="lg" className="rounded-full">Start Building</Button>
                                        <Button size="lg" variant="outline" className="rounded-full">Learn More</Button>
                                    </div>
                                </div>
                            </section>

                            {/* Content Cards */}
                            <section className="py-16 px-6 bg-background">
                                <div className="max-w-5xl mx-auto">
                                    <h2 className="text-2xl font-bold font-heading mb-8 text-center">Feature Showcase</h2>
                                    <div className="grid md:grid-cols-3 gap-6">
                                        {[1, 2, 3].map((i) => (
                                            <div key={i} className="rounded-xl border border-border bg-card text-card-foreground p-6 shadow-sm hover:shadow-md transition-shadow">
                                                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4 text-primary">
                                                    <PaletteIcon className="w-6 h-6" />
                                                </div>
                                                <h3 className="font-semibold text-lg mb-2 font-heading">Feature {i}</h3>
                                                <p className="text-muted-foreground text-sm leading-relaxed">
                                                    This card component demonstrates your card styling, border radius, and text contrast.
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </section>

                            {/* Form Section */}
                            <section className="py-16 px-6 bg-secondary/10">
                                <div className="max-w-md mx-auto bg-card rounded-xl shadow-sm p-8 border border-border">
                                    <h3 className="text-xl font-bold mb-6 font-heading">Contact Us</h3>
                                    <div className="space-y-4">
                                        <div className="space-y-2">
                                            <Label>Email Address</Label>
                                            <Input placeholder="you@example.com" />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Message</Label>
                                            <Textarea placeholder="Type your message here..." className="h-24" />
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <div className="h-4 w-4 rounded border border-primary bg-primary text-primary-foreground flex items-center justify-center">
                                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                            </div>
                                            <Label className="font-normal text-muted-foreground">Subscribe to newsletter</Label>
                                        </div>
                                        <Button className="w-full">Send Message</Button>
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
