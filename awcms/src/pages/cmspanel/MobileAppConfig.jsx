/**
 * MobileAppConfig Page
 * Configure mobile app settings
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Save, Smartphone, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useTenant, useAuth } from '@/contexts/PermissionContext';
import { useToast } from '@/components/ui/use-toast';
import { Skeleton } from '@/components/ui/skeleton';

function MobileAppConfig() {
    const { tenantId } = useTenant();
    const { user } = useAuth();
    const { toast } = useToast();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [config, setConfig] = useState({
        app_name: '',
        app_logo_url: '',
        primary_color: '#3b82f6',
        secondary_color: '#10b981',
        force_update_version: '',
        recommended_version: '',
        maintenance_mode: false,
        maintenance_message: '',
    });

    // Fetch config
    useEffect(() => {
        const fetchConfig = async () => {
            if (!tenantId) return;

            const { data, error } = await supabase
                .from('mobile_app_config')
                .select('*')
                .eq('tenant_id', tenantId)
                .single();

            if (data) {
                setConfig(data);
            }
            setLoading(false);
        };

        fetchConfig();
    }, [tenantId]);

    // Save config
    const handleSave = async () => {
        setSaving(true);
        try {
            const { error } = await supabase
                .from('mobile_app_config')
                .upsert({
                    ...config,
                    tenant_id: tenantId,
                    updated_by: user?.id,
                });

            if (error) throw error;

            toast({ title: 'Settings Saved' });
        } catch (err) {
            toast({
                variant: 'destructive',
                title: 'Error',
                description: err.message,
            });
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="space-y-6">
                <Skeleton className="h-8 w-64" />
                <Skeleton className="h-64" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold">Mobile App Config</h1>
                    <p className="text-muted-foreground">Configure mobile app settings</p>
                </div>

                <Button onClick={handleSave} disabled={saving}>
                    <Save className="mr-2 h-4 w-4" />
                    {saving ? 'Saving...' : 'Save Changes'}
                </Button>
            </div>

            {/* Branding */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Smartphone className="h-5 w-5" />
                        Branding
                    </CardTitle>
                    <CardDescription>Customize app appearance</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                        <div>
                            <Label>App Name</Label>
                            <Input
                                value={config.app_name}
                                onChange={(e) => setConfig({ ...config, app_name: e.target.value })}
                                placeholder="My App"
                            />
                        </div>
                        <div>
                            <Label>Logo URL</Label>
                            <Input
                                value={config.app_logo_url}
                                onChange={(e) => setConfig({ ...config, app_logo_url: e.target.value })}
                                placeholder="https://..."
                            />
                        </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                        <div>
                            <Label>Primary Color</Label>
                            <div className="flex gap-2">
                                <Input
                                    type="color"
                                    value={config.primary_color}
                                    onChange={(e) => setConfig({ ...config, primary_color: e.target.value })}
                                    className="w-16 h-10 p-1"
                                />
                                <Input
                                    value={config.primary_color}
                                    onChange={(e) => setConfig({ ...config, primary_color: e.target.value })}
                                />
                            </div>
                        </div>
                        <div>
                            <Label>Secondary Color</Label>
                            <div className="flex gap-2">
                                <Input
                                    type="color"
                                    value={config.secondary_color}
                                    onChange={(e) => setConfig({ ...config, secondary_color: e.target.value })}
                                    className="w-16 h-10 p-1"
                                />
                                <Input
                                    value={config.secondary_color}
                                    onChange={(e) => setConfig({ ...config, secondary_color: e.target.value })}
                                />
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Version Control */}
            <Card>
                <CardHeader>
                    <CardTitle>Version Control</CardTitle>
                    <CardDescription>Manage app update requirements</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                        <div>
                            <Label>Force Update Version</Label>
                            <Input
                                value={config.force_update_version}
                                onChange={(e) => setConfig({ ...config, force_update_version: e.target.value })}
                                placeholder="1.0.0"
                            />
                            <p className="text-xs text-muted-foreground mt-1">
                                Users below this version must update
                            </p>
                        </div>
                        <div>
                            <Label>Recommended Version</Label>
                            <Input
                                value={config.recommended_version}
                                onChange={(e) => setConfig({ ...config, recommended_version: e.target.value })}
                                placeholder="1.1.0"
                            />
                            <p className="text-xs text-muted-foreground mt-1">
                                Prompt users to update (optional)
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Maintenance Mode */}
            <Card className={config.maintenance_mode ? 'border-orange-500' : ''}>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <AlertTriangle className={config.maintenance_mode ? 'text-orange-500' : ''} />
                        Maintenance Mode
                    </CardTitle>
                    <CardDescription>Temporarily disable app access</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="font-medium">Enable Maintenance Mode</p>
                            <p className="text-sm text-muted-foreground">
                                Show maintenance screen to all users
                            </p>
                        </div>
                        <Switch
                            checked={config.maintenance_mode}
                            onCheckedChange={(checked) => setConfig({ ...config, maintenance_mode: checked })}
                        />
                    </div>

                    {config.maintenance_mode && (
                        <div>
                            <Label>Maintenance Message</Label>
                            <Textarea
                                value={config.maintenance_message}
                                onChange={(e) => setConfig({ ...config, maintenance_message: e.target.value })}
                                placeholder="We are currently performing maintenance. Please try again later."
                            />
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

export default MobileAppConfig;
