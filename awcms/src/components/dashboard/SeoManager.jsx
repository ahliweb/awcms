import React, { useState, useEffect, useCallback } from 'react';
import { Globe, Save, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { Textarea } from '@/components/ui/textarea';
import { useTenant } from '@/contexts/TenantContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { usePermissions } from '@/contexts/PermissionContext';
import { ShieldAlert } from 'lucide-react';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';

function SeoManager() {
    const { toast } = useToast();
    const { currentTenant } = useTenant();
    const { hasPermission } = usePermissions();
    const tenantId = currentTenant?.id;
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [globalSeo, setGlobalSeo] = useState({
        site_title: 'AWCMS - Advanced CMS',
        site_description: 'A powerful, secure, and extensible Content Management System.',
        default_keywords: 'cms, react, supabase, secure',
        og_image: '',
        twitter_handle: '@awcms'
    });

    /* 
     * Fetch SEO Settings from 'settings' table (key='seo_global')
     */
    const fetchSeoSettings = useCallback(async () => {
        if (!tenantId) return;

        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('settings')
                .select('value')
                .eq('key', 'seo_global')
                .eq('tenant_id', tenantId)
                .is('deleted_at', null)
                .maybeSingle();

            if (error) throw error;

            if (data?.value) {
                try {
                    const parsed = typeof data.value === 'string'
                        ? JSON.parse(data.value)
                        : data.value;
                    setGlobalSeo(prev => ({ ...prev, ...parsed }));
                } catch (parseError) {
                    console.error('Failed to parse SEO settings:', parseError);
                }
            }
        } catch (err) {
            console.error('Failed to load SEO settings:', err);
        } finally {
            setLoading(false);
        }
    }, [tenantId]);

    useEffect(() => {
        fetchSeoSettings();
    }, [tenantId, fetchSeoSettings]);

    const handleSave = async (e) => {
        e.preventDefault();
        setSaving(true);

        try {
            // All users should use their tenant_id for settings
            // The settings table requires tenant_id as part of primary key
            if (!tenantId) {
                throw new Error('No tenant context available. Please ensure you are properly logged in.');
            }

            const upsertData = {
                key: 'seo_global',
                value: JSON.stringify(globalSeo),
                type: 'json',
                description: 'Global SEO Configuration',
                is_public: true,
                deleted_at: null,
                tenant_id: tenantId
            };

            const { error } = await supabase
                .from('settings')
                .upsert(upsertData, {
                    onConflict: 'tenant_id,key'
                });

            if (error) throw error;

            toast({
                title: "Settings Saved",
                description: "Global SEO configuration has been updated."
            });
        } catch (err) {
            toast({
                variant: "destructive",
                title: "Error",
                description: "Failed to save settings: " + err.message
            });
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!hasPermission('tenant.seo.read')) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px] bg-card rounded-xl border border-border p-12 text-center">
                <div className="p-4 bg-destructive/10 rounded-full mb-4">
                    <ShieldAlert className="w-12 h-12 text-destructive" />
                </div>
                <h3 className="text-xl font-bold text-foreground">Access Denied</h3>
                <p className="text-muted-foreground mt-2">You do not have permission to view SEO settings.</p>
            </div>
        );
    }

    return (
        <AdminPageLayout requiredPermission="tenant.seo.read">
            <PageHeader
                title="SEO Management"
                description="Configure global metadata and search engine settings."
                icon={Globe}
                breadcrumbs={[{ label: 'SEO', icon: Globe }]}
            />

            <div className="max-w-4xl space-y-6">

                <Card>
                    <CardHeader>
                        <CardTitle>Meta Tags Configuration</CardTitle>
                        <CardDescription>These settings apply as defaults for all pages</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleSave} className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <Label htmlFor="site_title">Default Site Title</Label>
                                    <Input
                                        id="site_title"
                                        value={globalSeo.site_title}
                                        onChange={(e) => setGlobalSeo({ ...globalSeo, site_title: e.target.value })}
                                        placeholder="My Website"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="twitter_handle">Twitter Handle</Label>
                                    <Input
                                        id="twitter_handle"
                                        value={globalSeo.twitter_handle}
                                        onChange={(e) => setGlobalSeo({ ...globalSeo, twitter_handle: e.target.value })}
                                        placeholder="@username"
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="site_description">Default Meta Description</Label>
                                <Textarea
                                    id="site_description"
                                    value={globalSeo.site_description}
                                    onChange={(e) => setGlobalSeo({ ...globalSeo, site_description: e.target.value })}
                                    rows={3}
                                    placeholder="A brief description of your website..."
                                />
                                <p className="text-xs text-muted-foreground">
                                    Recommended: 150-160 characters for optimal display in search results
                                </p>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="default_keywords">Default Keywords (Comma separated)</Label>
                                <Input
                                    id="default_keywords"
                                    value={globalSeo.default_keywords}
                                    onChange={(e) => setGlobalSeo({ ...globalSeo, default_keywords: e.target.value })}
                                    placeholder="keyword1, keyword2, keyword3"
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="og_image">Default OG Image URL</Label>
                                <div className="flex gap-2">
                                    <Input
                                        id="og_image"
                                        value={globalSeo.og_image}
                                        onChange={(e) => setGlobalSeo({ ...globalSeo, og_image: e.target.value })}
                                        placeholder="https://example.com/og-image.jpg"
                                    />
                                    <Button type="button" variant="outline">Browse</Button>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    Recommended size: 1200x630 pixels for optimal display on social media
                                </p>
                            </div>

                            <div className="pt-4 border-t border-border flex justify-end">
                                <Button type="submit" disabled={saving}>
                                    {saving ? (
                                        <>
                                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                            Saving...
                                        </>
                                    ) : (
                                        <>
                                            <Save className="w-4 h-4 mr-2" />
                                            Save Configuration
                                        </>
                                    )}
                                </Button>
                            </div>
                        </form>
                    </CardContent>
                </Card>

                <Card className="bg-primary/5 border-primary/20">
                    <CardContent className="pt-6">
                        <div className="flex items-start gap-4">
                            <div className="p-3 bg-primary/10 rounded-lg text-primary">
                                <Globe className="w-6 h-6" />
                            </div>
                            <div>
                                <h3 className="font-bold text-foreground mb-1">Robots.txt & Sitemap</h3>
                                <p className="text-sm text-muted-foreground mb-4">
                                    Your sitemap is automatically generated at <code className="bg-muted px-1 py-0.5 rounded text-foreground font-mono">/sitemap.xml</code> based on public content visibility.
                                </p>
                                <Button variant="outline" size="sm" className="bg-background hover:bg-muted text-foreground border-border">
                                    View Sitemap
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </AdminPageLayout>
    );
}

export default SeoManager;
