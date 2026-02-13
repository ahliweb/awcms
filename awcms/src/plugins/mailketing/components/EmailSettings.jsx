import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useTenant } from '@/contexts/TenantContext';
import { usePermissions } from '@/contexts/PermissionContext';
import { useToast } from '@/components/ui/use-toast';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
    Mail,
    Save,
    TestTube,
    RefreshCw,
    CreditCard,
    AlertCircle,
    CheckCircle,
    ShieldAlert,
} from 'lucide-react';
import {
    getTenantEmailConfig,
    saveTenantEmailConfig,
    checkCredits,
    sendTestEmail,
} from '../services/emailService';

function EmailSettings() {
    const { t } = useTranslation();
    const { currentTenant } = useTenant();
    const { hasPermission } = usePermissions();
    const { toast } = useToast();

    const [config, setConfig] = useState({
        provider: 'mailketing',
        api_token: '',
        from_name: '',
        from_email: '',
        default_list_id: 1,
        enabled: true,
    });
    const [credits, setCredits] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testEmail, setTestEmail] = useState('');

    const canConfigure = hasPermission('tenant.setting.update');

    const loadConfig = useCallback(async () => {
        setLoading(true);
        try {
            const data = await getTenantEmailConfig(currentTenant.id);
            setConfig((prev) => ({ ...prev, ...data }));
        } catch (error) {
            console.error('Failed to load email config:', error);
        } finally {
            setLoading(false);
        }
    }, [currentTenant?.id]);

    const loadCredits = useCallback(async () => {
        try {
            const result = await checkCredits();
            if (result.status === 'true') {
                setCredits(result.credits);
            }
        } catch (error) {
            console.error('Failed to check credits:', error);
        }
    }, []);

    useEffect(() => {
        if (currentTenant?.id) {
            loadConfig();
            loadCredits();
        }
    }, [currentTenant?.id, loadConfig, loadCredits]);


    const handleSave = async () => {
        if (!canConfigure) return;

        setSaving(true);
        try {
            await saveTenantEmailConfig(currentTenant.id, config);
            toast({
                title: t('common.success'),
                description: 'Email settings saved successfully.',
            });
        } catch (error) {
            toast({
                title: t('common.error'),
                description: error.message,
                variant: 'destructive',
            });
        } finally {
            setSaving(false);
        }
    };

    const handleTestEmail = async () => {
        if (!testEmail) {
            toast({
                title: 'Enter email',
                description: 'Please enter an email address to send test to.',
                variant: 'destructive',
            });
            return;
        }

        setTesting(true);
        try {
            const result = await sendTestEmail(currentTenant.id, testEmail);
            if (result.status === 'success') {
                toast({
                    title: 'Test Email Sent',
                    description: `Email sent to ${testEmail}`,
                });
            } else {
                throw new Error(result.response || 'Failed to send');
            }
        } catch (error) {
            toast({
                title: 'Test Failed',
                description: error.message,
                variant: 'destructive',
            });
        } finally {
            setTesting(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <RefreshCw className="w-6 h-6 animate-spin text-slate-400" />
            </div>
        );
    }

    if (!canConfigure) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px] bg-white rounded-xl border border-slate-200 p-12 text-center">
                <div className="p-4 bg-red-50 rounded-full mb-4">
                    <ShieldAlert className="w-12 h-12 text-red-500" />
                </div>
                <h3 className="text-xl font-bold text-slate-800">Access Denied</h3>
                <p className="text-slate-500 mt-2">You do not have permission to configure email settings.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6 p-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Mail className="w-6 h-6" />
                        Email Settings
                    </h1>
                    <p className="text-slate-500 mt-1">
                        Configure Mailketing email integration
                    </p>
                </div>
                {credits !== null && (
                    <Card className="px-4 py-2">
                        <div className="flex items-center gap-2">
                            <CreditCard className="w-4 h-4 text-blue-500" />
                            <span className="text-sm text-slate-600">Credits:</span>
                            <span className="font-bold text-lg">{credits}</span>
                        </div>
                    </Card>
                )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Configuration Card */}
                <Card>
                    <CardHeader>
                        <CardTitle>Configuration</CardTitle>
                        <CardDescription>
                            Mailketing API settings for this tenant
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center justify-between">
                            <Label htmlFor="enabled">Enable Email Sending</Label>
                            <Switch
                                id="enabled"
                                checked={config.enabled}
                                onCheckedChange={(checked) =>
                                    setConfig((prev) => ({ ...prev, enabled: checked }))
                                }
                                disabled={!canConfigure}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="api_token">API Token</Label>
                            <Input
                                id="api_token"
                                type="password"
                                placeholder="Enter Mailketing API token"
                                value={config.api_token || ''}
                                onChange={(e) =>
                                    setConfig((prev) => ({ ...prev, api_token: e.target.value }))
                                }
                                disabled={!canConfigure}
                            />
                            <p className="text-xs text-slate-500">
                                Get from{' '}
                                <a
                                    href="https://be.mailketing.co.id/integration"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-500 hover:underline"
                                >
                                    Mailketing Dashboard
                                </a>
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="from_name">From Name</Label>
                            <Input
                                id="from_name"
                                placeholder="Sender Name"
                                value={config.from_name || ''}
                                onChange={(e) =>
                                    setConfig((prev) => ({ ...prev, from_name: e.target.value }))
                                }
                                disabled={!canConfigure}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="from_email">From Email</Label>
                            <Input
                                id="from_email"
                                type="email"
                                placeholder="noreply@example.com"
                                value={config.from_email || ''}
                                onChange={(e) =>
                                    setConfig((prev) => ({ ...prev, from_email: e.target.value }))
                                }
                                disabled={!canConfigure}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="default_list_id">Default List ID</Label>
                            <Input
                                id="default_list_id"
                                type="number"
                                placeholder="1"
                                value={config.default_list_id || 1}
                                onChange={(e) =>
                                    setConfig((prev) => ({
                                        ...prev,
                                        default_list_id: parseInt(e.target.value) || 1,
                                    }))
                                }
                                disabled={!canConfigure}
                            />
                        </div>

                        <Button
                            onClick={handleSave}
                            disabled={!canConfigure || saving}
                            className="w-full"
                        >
                            {saving ? (
                                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                            ) : (
                                <Save className="w-4 h-4 mr-2" />
                            )}
                            Save Settings
                        </Button>
                    </CardContent>
                </Card>

                {/* Test Email Card */}
                <Card>
                    <CardHeader>
                        <CardTitle>Test Email</CardTitle>
                        <CardDescription>
                            Send a test email to verify configuration
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="test_email">Recipient Email</Label>
                            <Input
                                id="test_email"
                                type="email"
                                placeholder="test@example.com"
                                value={testEmail}
                                onChange={(e) => setTestEmail(e.target.value)}
                            />
                        </div>

                        <Button
                            onClick={handleTestEmail}
                            disabled={testing || !config.enabled}
                            variant="outline"
                            className="w-full"
                        >
                            {testing ? (
                                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                            ) : (
                                <TestTube className="w-4 h-4 mr-2" />
                            )}
                            Send Test Email
                        </Button>

                        {!config.enabled && (
                            <div className="flex items-center gap-2 text-amber-600 text-sm">
                                <AlertCircle className="w-4 h-4" />
                                Enable email sending to test
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Status */}
            <Card>
                <CardContent className="py-4">
                    <div className="flex items-center gap-4">
                        {config.enabled ? (
                            <div className="flex items-center gap-2 text-green-600">
                                <CheckCircle className="w-5 h-5" />
                                <span>Email sending is enabled</span>
                            </div>
                        ) : (
                            <div className="flex items-center gap-2 text-slate-400">
                                <AlertCircle className="w-5 h-5" />
                                <span>Email sending is disabled</span>
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

export default EmailSettings;
